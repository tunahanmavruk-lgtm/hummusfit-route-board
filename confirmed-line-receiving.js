// Narrow pilot: Tony confirmed these four physical cases. This is NOT a
// completed order/report and never infers counts for omitted food or cases.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {ORDER_QUERY,CREATE_MUTATION,inspectOrders,planOrder}=require('./completion-fulfillment');
const {ORDER_QUERY:PROOF_ORDER_QUERY,GROUP_QUERY}=require('./automatic-receiving');
const {caseMapping,receiptKey}=require('./essentials-pos-conversion');
const {orderPolicy}=require('./store-fulfillment-policy');
const STORE='Lindenhurst', ORDER='gid://shopify/Order/8083583533303';
const SKUS=Object.freeze(['MF-7171000-CS','MF-7171008-CS','MF-7171013-CS','MF-7171015-CS']);
const ID='Lindenhurst::line-receipt::769574::phorm-bars-v1';
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function read(file){try{const x=JSON.parse(fs.readFileSync(file,'utf8'));if(!x||Array.isArray(x))throw Error('Invalid line receipt ledger');return x;}catch(e){if(e.code==='ENOENT')return {};throw e;}}
function write(file,key,value){const all=read(file);all[key]=value;const temp=file+'.tmp',fd=fs.openSync(temp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(all,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);const d=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}
function validateRequest(body){
  if(body?.store!==STORE||body.orderId!==ORDER||body.confirmedBy!=='Tony'||
    !Array.isArray(body.lines)||body.lines.length!==4||new Set(body.lines.map(l=>l.sku)).size!==4||
    body.lines.some(l=>!SKUS.includes(l.sku)||l.receivedCases!==1))throw Error('Only the four approved Lindenhurst bar cases are authorized');
  return SKUS.map(sku=>({sku,receivedCases:1}));
}
function selectedPlan(order){
  if(order?.id!==ORDER||order.name!=='#769574'||orderPolicy(order).store!==STORE)throw Error('Exact Lindenhurst order required');
  for(const sku of SKUS){const lines=order.lineItems?.nodes?.filter(l=>l.sku===sku)||[];if(lines.length!==1||lines[0].quantity!==1)throw Error('Confirmed bar line changed');}
  // Omitted lines keep their existing fulfilled quantity. They are NOT saved
  // as received zero, shortages, or backorders, and no completion job is made.
  const shipped=new Map();
  for(const f of order.fulfillments||[])for(const l of f.fulfillmentLineItems?.nodes||[])shipped.set(l.lineItem.id,(shipped.get(l.lineItem.id)||0)+l.quantity);
  const items=order.lineItems.nodes.map(l=>({key:(l.variantTitle&&l.variantTitle.toLowerCase()!=='default title'?l.title+' — '+l.variantTitle:l.title)+'::'+(l.sku||''),ordered:l.quantity,shipped:SKUS.includes(l.sku)?1:(shipped.get(l.id)||0)}));
  const job={store:STORE,orderIds:[ORDER],items};
  return planOrder(order,inspectOrders([order],job),job);
}
function verifyConversion(group,entry,locationId){
  const expected=entry?.plan?.input,changes=(group?.changes||[]).filter(c=>c.name==='available');
  if(entry?.status!=='posted'||entry.units!==15||entry.plan.receivedCases!==1||!group?.id||group.id!==entry.adjustmentId||
    group.referenceDocumentUri!==expected.referenceDocumentUri||changes.length!==2||
    expected.changes.some(e=>changes.filter(c=>c.item?.id===e.inventoryItemId&&c.location?.id===locationId&&c.delta===e.delta).length!==1))throw Error('Exact canonical case-to-unit proof required');
}
function createConfirmedLineReceiving(deps){
  const {dir,orderQuery,inventoryQuery,exactLocation,exactItem,activate,convert,loadCanonical,receivingService,now=Date.now}=deps;
  const file=path.join(dir,'confirmed-line-receipts-v1.json');let tail=Promise.resolve();
  function get(){return read(file)[ID]||null;}
  function save(r){write(file,ID,r);return r;}
  async function run(body){
    const lines=validateRequest(body);
    if(!deps.durable)throw Error('Persistent line receipt storage required');
    let receipt=get();
    const locationId=await exactLocation(STORE);
    if(locationId!=='gid://shopify/Location/69550473463')throw Error('Lindenhurst location changed');
    const order=(await orderQuery(ORDER_QUERY,{id:ORDER})).order;
    let plan=selectedPlan(order);
    const mappings=SKUS.map(sku=>{const m=caseMapping({sku,productTags:['retail-essentials']});if(m.error||m.unitsPerCase!==15)throw Error('Verified fifteen-unit mapping required');return {...m,receivedCases:1,pickedCases:1};});
    const stocks=[];
    for(const m of mappings){stocks.push({sku:m.caseSku,case:await exactItem(m.caseSku,locationId,false,true,m),unit:await exactItem(m.unitSku,locationId,true,true,m)});}
    if(!receipt){
      const review=body.historyReview;
      if(!review||review.orderId!==ORDER||review.locationId!==locationId||review.reviewedBy!=='Tony-authorized Logistics'||
        !Number.isFinite(Date.parse(review.checkedAt))||now()-Date.parse(review.checkedAt)<0||now()-Date.parse(review.checkedAt)>3600000||
        !Array.isArray(review.lines)||review.lines.length!==4||new Set(review.lines.map(l=>l.sku)).size!==4||
        SKUS.some(sku=>!review.lines.some(l=>l.sku===sku&&l.priorReceiptUnits===0&&l.priorCaseCredits===0&&l.salesUnits===0&&l.noAdjustments180Days===true)))throw Error('Fresh manual Shopify history review is required; do not assume inactive means zero');
      if(plan.done||order.fulfillments.length||deps.hasPriorProof(ORDER)||
        stocks.some(s=>![null,0].includes(s.case.available)||![null,0].includes(s.unit.available))||
        SKUS.some(sku=>loadCanonical()[receiptKey(STORE,ORDER,sku)]))throw Error('Prior fulfillment, balance or receipt proof needs reconciliation before new posting');
      receipt=save({id:ID,store:STORE,orderId:ORDER,orderName:'#769574',scope:'selected_lines_only',status:'confirmed',confirmedBy:body.confirmedBy,
        submittedAt:new Date(now()).toISOString(),lines,historyReview:review,before:stocks,results:[],otherLines:'pending_unconfirmed'});
    }
    if(receipt.id!==ID||hash(receipt.lines)!==hash(lines))throw Error('Saved receipt identity or counts changed');
    try{
      if(!plan.done){
        if(receipt.fulfillmentAttemptedAt)throw Error('Fulfillment outcome uncertain: reconcile only, never resend');
        // Restore inactive levels without resetting retained stock. Recheck
        // preserved balances before the first fulfillment, not after sales.
        for(const m of mappings){
          for(const sellable of [false,true]){
            const sku=sellable?m.unitSku:m.caseSku;let item=await exactItem(sku,locationId,sellable,true,m);
            if(item.available===null){await activate(item,locationId,'line-receipt:'+ID+':'+sku);item=await exactItem(sku,locationId,sellable,false,m);}
            if(item.available!==0)throw Error('Preserved stock is not zero; reconcile history before fulfillment');
          }
        }
        const fresh=(await orderQuery(ORDER_QUERY,{id:ORDER})).order;
        plan=selectedPlan(fresh);
        if(fresh.fulfillments.length||deps.hasPriorProof(ORDER)||SKUS.some(sku=>loadCanonical()[receiptKey(STORE,ORDER,sku)]))throw Error('Concurrent posting detected before fulfillment');
        receipt=save({...receipt,status:'fulfillment_verifying',fulfillmentAttemptedAt:new Date(now()).toISOString(),fulfillmentInput:plan.fulfillment});
        const result=(await orderQuery(CREATE_MUTATION,{fulfillment:plan.fulfillment})).fulfillmentCreate;
        if(result?.userErrors?.length||result?.fulfillment?.status!=='SUCCESS'||!result.fulfillment.id)throw Error('Fulfillment not confirmed; inspect Shopify before retry');
        receipt=save({...receipt,fulfillmentId:result.fulfillment.id});
      }
      const fresh=(await orderQuery(ORDER_QUERY,{id:ORDER})).order;
      if(!selectedPlan(fresh).done)throw Error('Selected fulfillment quantities are not proven');
      const selectedIds=new Set(fresh.lineItems.nodes.filter(l=>SKUS.includes(l.sku)).map(l=>l.id));
      const selectedFulfillments=fresh.fulfillments.filter(f=>f.fulfillmentLineItems.nodes.some(l=>selectedIds.has(l.lineItem.id)));
      if(selectedFulfillments.length!==1||selectedFulfillments[0].fulfillmentLineItems.nodes.length!==4||selectedFulfillments[0].fulfillmentLineItems.nodes.some(l=>!selectedIds.has(l.lineItem.id)||l.quantity!==1))throw Error('Exact four-line fulfillment proof required');
      receipt=save({...receipt,status:'inventory_verifying',fulfillmentId:selectedFulfillments[0].id});
      const proofOrder=(await orderQuery(PROOF_ORDER_QUERY,{id:ORDER})).order;
      for(const m of mappings){
        const line=proofOrder.lineItems.nodes.find(l=>l.sku===m.caseSku);
        const credit=await receivingService.flowProof({mode:'store_fulfillment_v1',store:STORE,orderId:ORDER,fulfillmentId:receipt.fulfillmentId,lineItemId:line.id});
        await receivingService.verifyFulfillmentCredit(proofOrder,line);
        const result=await convert(STORE,ORDER,locationId,m);
        if(!['posted','already_posted'].includes(result.status))throw Error(m.caseSku+': '+(result.error||result.status));
        const entry=loadCanonical()[receiptKey(STORE,ORDER,m.caseSku)];
        verifyConversion((await inventoryQuery(GROUP_QUERY,{id:entry.adjustmentId})).node,entry,locationId);
        const afterCase=await exactItem(m.caseSku,locationId,false,false,m),afterUnit=await exactItem(m.unitSku,locationId,true,false,m);
        receipt=save({...receipt,results:[...receipt.results.filter(r=>r.sku!==m.caseSku),{sku:m.caseSku,unitSku:m.unitSku,receivedCases:1,postedUnits:15,
          caseCreditAdjustmentId:credit.adjustmentId,adjustmentId:entry.adjustmentId,caseAvailable:afterCase.available,unitAvailable:afterUnit.available}]});
      }
      return save({...receipt,status:'selected_lines_posted',verifiedAt:new Date(now()).toISOString(),error:null});
    }catch(e){save({...receipt,status:'requires_review',error:e.message});throw e;}
  }
  return {get,run(body){const next=tail.then(()=>run(body),()=>run(body));tail=next.catch(()=>{});return next;}};
}
module.exports={STORE,ORDER,SKUS,ID,validateRequest,selectedPlan,verifyConversion,createConfirmedLineReceiving};
