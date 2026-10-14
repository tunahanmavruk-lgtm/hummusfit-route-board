const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifiedStoreFlowCredit } = require('./store-flow-credit-proof');
const { POS_STORE_LOCATIONS } = require('./essentials-pos-conversion');
const { receiptOrders,receiptForOrder } = require('./receipt-orders');

const RELEASE = 'receiving-auto-2026-10-13-v1';
const CUTOVER = Date.parse('2026-10-13T20:21:19Z');
const WAREHOUSE = 'gid://shopify/Location/103133642999';
const ORDER_QUERY = `query AutomaticReceiptOrder($id: ID!) {
  order(id: $id) { id name createdAt displayFulfillmentStatus tags customer { tags }
    fulfillments(first: 100) { id status location { id } }
    lineItems(first: 250) { pageInfo { hasNextPage } nodes { id sku quantity
      variant { id inventoryItem { id } }
    } }
  }
}`;
const GROUP_QUERY = `query AutomaticReceiptGroup($id: ID!) {
  node(id: $id) { ... on InventoryAdjustmentGroup { id createdAt reason referenceDocumentUri app { id }
    changes { name delta item { id sku } location { id } }
  } }
}`;
const VARIANT_QUERY = `query AutomaticReceiptVariant($id: ID!, $locationId: ID!) {
  productVariant(id: $id) { id sku barcode product { status tags collections(first: 100) { nodes { title } pageInfo { hasNextPage } } }
    inventoryItem { id sku tracked inventoryLevel(locationId: $locationId) { quantities(names: ["available"]) { name quantity } } }
  }
}`;
const ADJUST_MUTATION = `mutation AutomaticReceiptCorrection($input: InventoryAdjustQuantitiesInput!, $key: String!) {
  inventoryAdjustQuantities(input: $input) @idempotent(key: $key) {
    inventoryAdjustmentGroup { id }
    userErrors { code field message }
  }
}`;
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
class Review extends Error {}
class Retry extends Error {}
function assert(ok, message) { if (!ok) throw new Review(message); }
function gid(kind, value) { return new RegExp(`^gid://shopify/${kind}/[0-9]+$`).test(value || ''); }
function read(file) {
  try { const value=JSON.parse(fs.readFileSync(file,'utf8')); assert(value && !Array.isArray(value),'Invalid inventory ledger'); return value; }
  catch(e) { if(e.code==='ENOENT') return {}; throw e; }
}
function write(file, key, value) {
  const ledger=read(file); ledger[key]=value;
  const temp=`${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp,JSON.stringify(ledger,null,2)); fs.renameSync(temp,file);
}
function isFood(product) {
  if (!product || product.status!=='ACTIVE' || product.collections?.pageInfo?.hasNextPage) return false;
  return ![...(product.tags||[]),...(product.collections?.nodes||[]).map(c=>c.title)]
    .some(t=>/essentials|pos.sell.unit/i.test(t));
}
function checkOrder(report, order) {
  assert(Object.hasOwn(POS_STORE_LOCATIONS,report?.store),'Store is outside the 14 POS locations');
  assert(report.automation?.version===RELEASE && Date.parse(report.submittedAt)>=CUTOVER &&
    Date.parse(report.submittedAt)<=Date.now()+60000 && !report.supersededBy,'Receipt is outside the automatic cutover');
  assert(gid('Order',report.orderId) && order?.id===report.orderId && order.name===report.orderName,
    'Exact receipt order is required');
  assert(Date.parse(order.createdAt)>=Date.parse('2026-10-06T04:00:00Z'),'Historical order requires manual verification');
  const tags=(order.customer?.tags||[]).map(t=>t.trim().toLowerCase());
  const stores=Object.keys(POS_STORE_LOCATIONS).filter(s=>tags.includes(`hummus fit ${s.toLowerCase()}`)||
    (s==='Islip'&&tags.includes('hummus fit east islip')));
  assert(stores.length===1&&stores[0]===report.store,'Order destination does not match this store');
  if(order.displayFulfillmentStatus!=='FULFILLED') throw new Retry('Waiting for Shopify warehouse fulfillment');
  assert(order.fulfillments?.length>0&&order.fulfillments.length<100&&order.fulfillments.every(f=>
    f.status==='SUCCESS'&&f.location?.id===WAREHOUSE),'Warehouse fulfillment is not uniquely proven');
  assert(Array.isArray(order.lineItems?.nodes)&&!order.lineItems.pageInfo?.hasNextPage,'Complete Shopify order lines required');
}
function verifyGroup(group, plan) {
  const changes=(group?.changes||[]).filter(c=>c.name==='available');
  assert(gid('InventoryAdjustmentGroup',group?.id)&&group.referenceDocumentUri===plan.input.referenceDocumentUri&&
    changes.length===1&&changes[0].delta===plan.delta&&changes[0].item?.id===plan.inventoryItemId&&
    changes[0].location?.id===plan.locationId,'Exact Shopify adjustment proof does not match');
}

function createAutomaticReceiving({dir, orderQuery, inventoryQuery, exactLocation, env=process.env, now=Date.now}) {
  const ledgerFile=path.join(dir,'automatic-receiving-v1.json');
  const flowFile=path.join(dir,'store-flow-credit-proofs.json');
  const holbrookFile=path.join(dir,'holbrook-flow-credit-proofs.json');
  const flights=new Map();
  const flowAppId=env.HOLBROOK_FLOW_APP_ID;
  async function flowProof(body, holbrook=false) {
    const {orderId,lineItemId,adjustmentGroupId}=body;
    const store=holbrook?'Holbrook':body.store;
    assert(Object.hasOwn(POS_STORE_LOCATIONS,store)&&gid('Order',orderId)&&gid('LineItem',lineItemId)&&
      gid('InventoryAdjustmentGroup',adjustmentGroupId)&&gid('App',flowAppId),'Exact Flow identifiers required');
    const [data,proof,locationId]=await Promise.all([orderQuery(ORDER_QUERY,{id:orderId}),
      inventoryQuery(GROUP_QUERY,{id:adjustmentGroupId}),exactLocation(store)]);
    const entry=verifiedStoreFlowCredit({store,order:data.order,group:proof.node,lineItemId,locationId,
      warehouseLocationId:WAREHOUSE,cutover:Date.parse('2026-10-06T04:00:00Z'),flowAppId});
    if(!entry) return {ok:true,status:'ignored_unmapped_line'};
    const file=holbrook?holbrookFile:flowFile,key=holbrook?`${orderId}:${lineItemId}`:`${store}:${orderId}:${lineItemId}`;
    const previous=read(file)[key];
    if(previous && previous.adjustmentId!==entry.adjustmentId) {
      write(file,key,{...previous,duplicateAdjustmentIds:[...new Set([...(previous.duplicateAdjustmentIds||[]),entry.adjustmentId])]});
      throw new Review('Multiple Shopify credits exist for this order line');
    }
    write(file,key,{...entry,...(previous?.duplicateAdjustmentIds?{duplicateAdjustmentIds:previous.duplicateAdjustmentIds}:{})});
    return {ok:true,status:'verified',store,adjustmentGroupId:entry.adjustmentId};
  }
  async function creditFor(report,order,line,locationId) {
    const source=report.store==='Holbrook'?read(holbrookFile):read(flowFile);
    const entries=Object.values(source).filter(e=>e.orderId===order.id&&e.lineItemId===line.id&&e.locationId===locationId);
    if(!entries.length) throw new Retry('Waiting for original Shopify Flow credit proof');
    assert(entries.length===1&&!entries[0].duplicateAdjustmentIds?.length,'Original Flow credit is duplicated');
    const proof=await inventoryQuery(GROUP_QUERY,{id:entries[0].adjustmentId});
    verifiedStoreFlowCredit({store:report.store,order,group:proof.node,lineItemId:line.id,locationId,
      warehouseLocationId:WAREHOUSE,cutover:Date.parse('2026-10-06T04:00:00Z'),flowAppId});
  }
  async function correct(report,order,locationId,item,kind) {
    const sku=item.sku;
    assert(typeof sku==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(sku),'A verified product SKU is required');
    const key=hash([kind==='extra'?'agent-hazar-extra':'agent-hazar-food',report.store,report.orderId,sku]);
    const line=order.lineItems.nodes.filter(l=>l.sku===sku);
    const delta=kind==='extra'?item.qty:item.actuallyReceived-item.orderedQty;
    assert(Number.isSafeInteger(delta)&&delta!==0&&delta<=10,'Large or invalid overage requires a physical-count confirmation');
    let variantId;
    if(kind==='food') {
      assert(line.length===1&&report.items.filter(i=>i.sku===sku).length===1&&item.receivingCategory==='food'&&
        Number.isSafeInteger(item.actuallyReceived)&&item.actuallyReceived>=0&&item.orderedQty===line[0].quantity&&
        item.orderDiff===delta,'Exact food order line and received count required');
      variantId=line[0].variant.id;
    } else {
      assert(['scan','entered'].includes(item.source)&&item.catalogVerified===true&&item.catalogStatus==='matched'&&
        Number.isSafeInteger(item.qty)&&item.qty>0&&line.length===0&&!report.items.some(i=>i.sku===sku)&&
        report.extraItems.filter(i=>i.sku===sku).length===1,'Wrong/extra item needs a unique scanned catalog identity');
      variantId=item.variantId;
    }
    assert(gid('ProductVariant',variantId),'Verified variant required');
    let previous=read(ledgerFile)[key];
    if(previous) {
      assert(previous.reportId===report.id&&previous.delta===delta&&previous.variantId===variantId,
        'Another receipt or changed count already owns this order correction');
      if(previous.status==='review') throw new Review(previous.error);
    }
    if(!previous?.plan) {
      if(kind==='food') await creditFor(report,order,line[0],locationId);
      const data=await inventoryQuery(VARIANT_QUERY,{id:variantId,locationId}),variant=data.productVariant;
      assert(variant?.id===variantId&&variant.sku===sku&&variant.inventoryItem?.sku===sku&&
        variant.inventoryItem.tracked===true&&isFood(variant.product),'Active food inventory item required');
      if(kind==='extra') assert([variant.barcode,variant.sku].filter(Boolean).includes(item.code),'Scanned barcode no longer matches the product');
      if(kind==='food') assert(variant.inventoryItem.id===line[0].variant.inventoryItem.id,'Order product identity changed');
      const available=variant.inventoryItem.inventoryLevel?.quantities?.find(q=>q.name==='available')?.quantity;
      assert(Number.isSafeInteger(available),'Food inventory is not active at the destination POS');
      const attempt=previous?.attempt||0;
      const plan={delta,locationId,inventoryItemId:variant.inventoryItem.id,
        key:hash([key,attempt]),input:{name:'available',reason:'correction',
          referenceDocumentUri:`gid://agent-hazar-receiving/${kind==='extra'?'ExtraCorrection':'FoodCorrection'}/${key}`,
          changes:[{inventoryItemId:variant.inventoryItem.id,locationId,delta,changeFromQuantity:available}]}};
      previous={reportId:report.id,store:report.store,orderId:report.orderId,sku,kind,delta,variantId,attempt,
        status:'pending',startedAt:now(),plan};
      // Persist BEFORE sending. On an uncertain response, only this exact key/input may be retried.
      write(ledgerFile,key,previous);
    }
    if(!previous.adjustmentId) {
      assert(now()-previous.startedAt<3600000,'Uncertain adjustment exceeded safe retry window; verify Shopify before retrying');
      const result=await inventoryQuery(ADJUST_MUTATION,{input:previous.plan.input,key:previous.plan.key});
      const adjustment=result.inventoryAdjustQuantities,errors=adjustment?.userErrors||[];
      if(!adjustment?.inventoryAdjustmentGroup?.id) {
        if(errors.length&&errors.every(e=>e.code==='CHANGE_FROM_QUANTITY_STALE')&&previous.attempt<4) {
          write(ledgerFile,key,{...previous,status:'retry',attempt:previous.attempt+1,plan:null});
          throw new Retry('Stock changed during correction; retrying against current quantity');
        }
        if(errors.length) {
          const error=errors.map(e=>e.message).join('; ');
          write(ledgerFile,key,{...previous,status:'review',error}); throw new Review(error);
        }
        throw new Retry('Shopify response is uncertain; retrying the same protected adjustment');
      }
      assert(!errors.length,'Shopify returned conflicting adjustment proof');
      previous={...previous,status:'verifying',adjustmentId:adjustment.inventoryAdjustmentGroup.id};
      write(ledgerFile,key,previous);
    }
    const proof=await inventoryQuery(GROUP_QUERY,{id:previous.adjustmentId});
    verifyGroup(proof.node,previous.plan);
    write(ledgerFile,key,{...previous,status:'posted',postedAt:proof.node.createdAt});
    return {kind,sku,status:'posted',adjustmentId:proof.node.id,variantId:kind==='extra'?variantId:undefined};
  }
  async function process(report) {
    let references;
    try { references=receiptOrders(report); } catch(e) { throw new Review(e.message); }
    const orders=[];
    // Validate every destination and fulfillment before any mutation.
    for(const reference of references) {
      const {order}=await orderQuery(ORDER_QUERY,{id:reference.id});
      checkOrder(receiptForOrder(report,reference.id),order); orders.push(order);
    }
    const locationId=await exactLocation(report.store),results=[];
    const jobs=[...(report.items||[]).filter(i=>i.receivingCategory==='food'&&i.orderDiff!==0).map(item=>({item,kind:'food'})),
      ...(report.extraItems||[]).map(item=>({item,kind:'extra'}))];
    for(const {item,kind}of jobs) {
      try {
        const owners=kind==='food'?orders.filter(o=>o.lineItems.nodes.some(l=>l.sku===item.sku)):orders;
        assert(owners.length===1,'Combined receipt item requires one unambiguous source order; allocation needs review');
        const order=owners[0],scoped=receiptForOrder(report,order.id);
        results.push({...await correct(scoped,order,locationId,item,kind),orderId:order.id});
      }
      catch(error) { results.push({kind,sku:item.sku||'',code:item.code,status:error instanceof Review?'requires_review':'retry',error:error.message}); }
    }
    return {ok:true,results};
  }
  async function reconcile(report) {
    if(env.RECEIVING_AUTOMATION_ENABLED==='false') throw new Retry('Automatic receiving corrections are paused');
    let references;
    try { references=receiptOrders(report); } catch(e) { throw new Review(e.message); }
    const keys=references.map(o=>`${report?.store}:${o.id}`);
    if(keys.some(key=>flights.has(key))) throw new Retry('This order is already processing');
    const promise=process(report).finally(()=>keys.forEach(key=>flights.delete(key)));
    keys.forEach(key=>flights.set(key,promise)); return promise;
  }
  return {flowProof,reconcile};
}
function registerAutomaticReceiving(app,deps) {
  const service=createAutomaticReceiving(deps);
  for(const [url,holbrook]of [['/api/store-flow-credit-proof',false],['/api/holbrook-flow-credit-proof',true]]) {
    app.post(url,async(req,res)=>{
      const supplied=Buffer.from(String(req.get('x-hf-flow-credit-secret')||''));
      const expected=Buffer.from(process.env.HOLBROOK_FLOW_CREDIT_SECRET||'');
      if(!expected.length||supplied.length!==expected.length||!crypto.timingSafeEqual(supplied,expected)) return res.status(403).json({error:'Shopify Flow authorization required'});
      try { res.json(await service.flowProof(req.body,holbrook)); }
      catch(e) { console.error('[receiving-flow-proof]',e.message); res.status(e instanceof Review?409:503).json({error:e.message}); }
    });
  }
  app.post('/api/automatic-receiving-correction',async(req,res)=>{
    const token=String(req.get('authorization')||'').replace(/^Bearer /,'');
    const identity=deps.verifyToken(token,'essentials.receive');
    if(!identity||identity.sub!=='hummusfit-receiving') return res.status(403).json({error:'Receiving service authorization required'});
    if(process.env.RAILWAY_ENVIRONMENT_ID && deps.dir!=='/data') return res.status(503).json({error:'Persistent inventory ledger volume is unavailable'});
    try { res.json(await service.reconcile(req.body?.report)); }
    catch(e) { res.status(e instanceof Review?409:503).json({error:e.message}); }
  });
  app.get('/api/receiving-automation-health',(_req,res)=>res.json({version:RELEASE,cutover:new Date(CUTOVER).toISOString(),stores:14,flowProofConfigured:!!process.env.HOLBROOK_FLOW_CREDIT_SECRET}));
  return service;
}
module.exports={RELEASE,CUTOVER,ORDER_QUERY,GROUP_QUERY,VARIANT_QUERY,ADJUST_MUTATION,Review,Retry,
  checkOrder,verifyGroup,createAutomaticReceiving,registerAutomaticReceiving};
