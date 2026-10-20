const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { deliveredQuantities, LOCATION } = require('./huntington-fulfillment');
const {storePolicy,orderPolicy}=require('./store-fulfillment-policy');
const {VERIFIED_CASE_MAPPINGS}=require('./essentials-pos-conversion');
const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const read = file => { try { const r = JSON.parse(fs.readFileSync(file, 'utf8')); if (!r || Array.isArray(r)) throw new Error('Invalid credit ledger'); return r; } catch(e) { if(e.code === 'ENOENT') return {}; throw e; } };
const STOCK_QUERY = `query HuntingtonCreditStock($id:ID!,$locationId:ID!){inventoryItem(id:$id){id sku tracked inventoryLevel(locationId:$locationId){quantities(names:["available"]){name quantity}}}}`;
const ACTIVATE_CASE_MUTATION = `mutation ActivateFulfilledCase($inventoryItemId:ID!,$locationId:ID!,$key:String!){inventoryActivate(inventoryItemId:$inventoryItemId,locationId:$locationId) @idempotent(key:$key){inventoryLevel{id} userErrors{field message}}}`;
function verifyCredit(group, entry) {
  const changes = (group?.changes || []).filter(c => c.name === 'available');
  if (!/^gid:\/\/shopify\/InventoryAdjustmentGroup\/\d+$/.test(group?.id || '') ||
      group.referenceDocumentUri !== entry.input.referenceDocumentUri || changes.length !== 1 ||
      changes[0].item?.id !== entry.inventoryItemId || changes[0].location?.id !== (entry.locationId||LOCATION) ||
      changes[0].delta !== entry.quantity) throw new Error('Exact Huntington fulfillment credit proof does not match');
}
function createFulfillmentCredit({dir, orderQuery, inventoryQuery, orderQueryText, groupQuery, adjustMutation, exactLocation, now=Date.now}) {
  const file = path.join(dir, 'huntington-fulfillment-credits-v1.json'), flights = new Map();
  function write(key, value) {
    const all=read(file);all[key]=value;const tmp=file+'.tmp',fd=fs.openSync(tmp,'w');
    try{fs.writeFileSync(fd,JSON.stringify(all,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    fs.renameSync(tmp,file);const directory=fs.openSync(dir,'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
  }
  async function credit({store, orderId, fulfillmentId, lineItemId}) {
    const {locationId}=storePolicy(store);
    if (!/^gid:\/\/shopify\/Order\/\d+$/.test(orderId || '') ||
        !/^gid:\/\/shopify\/Fulfillment\/\d+$/.test(fulfillmentId || '') ||
        !/^gid:\/\/shopify\/LineItem\/\d+$/.test(lineItemId || '')) throw new Error('Exact Huntington fulfillment identifiers required');
    const key=hash([store==='Huntington'?'huntington-fulfillment-v1':'store-fulfillment-v1', orderId, fulfillmentId, lineItemId, locationId]);
    if(flights.has(key)) return flights.get(key);
    const promise=(async()=>{
      const {order}=await orderQuery(orderQueryText,{id:orderId});
      if(order?.id!==orderId) throw new Error('Exact order required');
      if(orderPolicy(order).store!==store) throw new Error('Fulfillment destination does not match callback');
      if(exactLocation && await exactLocation(store)!==locationId) throw new Error('Store location identity changed');
      deliveredQuantities(order);
      const fulfillment=order.fulfillments.find(f=>f.id===fulfillmentId);
      if(!fulfillment) throw new Error('Fulfillment does not belong to order');
      const fulfilled=fulfillment.fulfillmentLineItems.nodes.find(l=>l.lineItem.id===lineItemId);
      // The Flow loop can include unshipped lines; these MUST do nothing.
      if(!fulfilled) return {ok:true,status:'not_in_fulfillment',lineItemId};
      const line=order.lineItems.nodes.find(l=>l.id===lineItemId), inventoryItemId=line.variant?.inventoryItem?.id;
      if(!line.sku || !/^gid:\/\/shopify\/InventoryItem\/\d+$/.test(inventoryItemId||'')) return {ok:true,status:'receipt_only',lineItemId};
      const legacy=[...Object.values(read(path.join(dir,'store-flow-credit-proofs.json'))),...Object.values(read(path.join(dir,'holbrook-flow-credit-proofs.json')))].filter(e=>e.orderId===orderId&&e.lineItemId===lineItemId);
      if(legacy.length) throw new Error('Existing legacy Flow credit requires reconciliation; no additional credit sent');
      let entry=read(file)[key];
      if(entry && (entry.quantity!==fulfilled.quantity || entry.inventoryItemId!==inventoryItemId || entry.sku!==line.sku)) throw new Error('Fulfillment changed after credit started');
      if(!entry) {
        let stock=(await inventoryQuery(STOCK_QUERY,{id:inventoryItemId,locationId})).inventoryItem;
        let available=stock?.inventoryLevel?.quantities?.find(q=>q.name==='available')?.quantity;
        // Only an exact, approved Retail Essentials case may have a missing store
        // inventory level activated. Activation omits quantities: it credits zero.
        const mapping=VERIFIED_CASE_MAPPINGS[line.sku];
        if(stock?.id===inventoryItemId&&stock.sku===line.sku&&stock.tracked===true&&
           !stock.inventoryLevel&&mapping?.caseVariantId===line.variant?.id) {
          const activationKey=hash(['activate-fulfilled-case-v1',locationId,inventoryItemId]);
          const activated=(await inventoryQuery(ACTIVATE_CASE_MUTATION,{inventoryItemId,locationId,key:activationKey})).inventoryActivate;
          if(!activated?.inventoryLevel?.id||activated.userErrors?.length) throw new Error('Verified case destination activation failed');
          stock=(await inventoryQuery(STOCK_QUERY,{id:inventoryItemId,locationId})).inventoryItem;
          available=stock?.inventoryLevel?.quantities?.find(q=>q.name==='available')?.quantity;
        }
        if(stock?.id!==inventoryItemId||stock.sku!==line.sku||stock.tracked!==true||!Number.isSafeInteger(available)) throw new Error('Destination inventory identity or activation needs review');
        entry={status:'pending',store,locationId,orderId,fulfillmentId,lineItemId,sku:line.sku,inventoryItemId,quantity:fulfilled.quantity,startedAt:now(),key,
          input:{name:'available',reason:'correction',referenceDocumentUri:`gid://agent-hazar-receiving/FulfillmentCredit/${key}`,
            changes:[{inventoryItemId,locationId,delta:fulfilled.quantity,changeFromQuantity:available}]}};
        write(key,entry); // Durable before ANY inventory request.
      }
      if(!entry.adjustmentId) {
        if(entry.status==='review'||!(now()-entry.startedAt>=0&&now()-entry.startedAt<3600000)) throw new Error('Uncertain credit requires Shopify review; never replay with a new key');
        const result=(await inventoryQuery(adjustMutation,{input:entry.input,key:entry.key})).inventoryAdjustQuantities;
        if(result?.userErrors?.length) { entry={...entry,status:'review',error:result.userErrors.map(e=>e.message).join('; ')};write(key,entry);throw new Error(entry.error); }
        if(!result?.inventoryAdjustmentGroup?.id) throw new Error('Uncertain Shopify credit; retry same saved key only');
        entry={...entry,status:'verifying',adjustmentId:result.inventoryAdjustmentGroup.id};write(key,entry);
      }
      const group=(await inventoryQuery(groupQuery,{id:entry.adjustmentId})).node;
      verifyCredit(group,entry);
      write(key,{...entry,status:'posted',postedAt:group.createdAt});
      return {ok:true,status:'posted',lineItemId,adjustmentId:group.id};
    })().finally(()=>flights.delete(key));
    flights.set(key,promise);return promise;
  }
  async function verifyLine(order,line) {
    const {store,locationId}=orderPolicy(order);
    const totals=deliveredQuantities(order);
    if(totals.get(line.id)!==line.quantity) throw new Error('This line is not fully delivered');
    const expected=order.fulfillments.flatMap(f=>f.fulfillmentLineItems.nodes.filter(l=>l.lineItem.id===line.id).map(l=>({f,l})));
    for(const {f,l}of expected) {
      const key=hash([store==='Huntington'?'huntington-fulfillment-v1':'store-fulfillment-v1',order.id,f.id,line.id,locationId]);
      const entry=read(file)[key];
      if(entry?.status!=='posted'||entry.quantity!==l.quantity||entry.inventoryItemId!==line.variant?.inventoryItem?.id) throw new Error('Waiting for exact delivered-line store credit proof');
      verifyCredit((await inventoryQuery(groupQuery,{id:entry.adjustmentId})).node,entry);
    }
    return true;
  }
  return {credit,verifyLine};
}
module.exports={createFulfillmentCredit,verifyCredit,STOCK_QUERY,ACTIVATE_CASE_MUTATION};
