// Completion is not fulfillment. Persist the immutable shipment intent before
// contacting Shopify; after an uncertain write only reconcile, never resend.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { POS_STORE_LOCATIONS } = require('./essentials-pos-conversion');
const { WAREHOUSE } = require('./huntington-fulfillment');
const {PARTIAL_FULFILLMENT_STORES}=require('./store-fulfillment-policy');
const ORDER_QUERY = `query CompletionOrder($id:ID!){order(id:$id){id name cancelledAt tags customer{tags} displayFulfillmentStatus
  lineItems(first:250){nodes{id title variantTitle sku quantity currentQuantity} pageInfo{hasNextPage}}
  fulfillmentOrders(first:100){nodes{id status assignedLocation{location{id}} lineItems(first:250){nodes{id remainingQuantity lineItem{id}} pageInfo{hasNextPage}}} pageInfo{hasNextPage}}
  fulfillments(first:100){id status location{id} fulfillmentLineItems(first:250){nodes{quantity lineItem{id}} pageInfo{hasNextPage}}}
}}`;
const CREATE_MUTATION = `mutation CompletionFulfillment($fulfillment:FulfillmentInput!){fulfillmentCreate(fulfillment:$fulfillment){fulfillment{id status} userErrors{field message}}}`;
const itemKey = item => `${item.title}::${item.sku || ''}`;
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonicalStore = stop => Object.keys(POS_STORE_LOCATIONS).find(s =>
  POS_STORE_LOCATIONS[s].toLowerCase() === String(stop).toLowerCase() || s.toLowerCase() === String(stop).toLowerCase());
const read = file => {
  try { const result=JSON.parse(fs.readFileSync(file,'utf8')); if(!result || Array.isArray(result)) throw Error('Invalid completion ledger'); return result; }
  catch(e) { if(e.code==='ENOENT') return {}; throw e; }
};
function durableWrite(file, value) {
  const temp=file+'.tmp', fd=fs.openSync(temp,'w');
  try { fs.writeFileSync(fd,JSON.stringify(value,null,2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp,file);
  const dir=fs.openSync(path.dirname(file),'r'); try {fs.fsyncSync(dir);} finally {fs.closeSync(dir);}
}
function backorderDecision(orderId,item,scanned,picker) {
  if(!orderId || !picker || !Number.isSafeInteger(item.quantity) || item.quantity<1 ||
    !Number.isSafeInteger(scanned) || scanned<0 || scanned>=item.quantity) throw Error('An exact missing case quantity and picker are required');
  return {orderId,key:itemKey(item),ordered:item.quantity,scanned,backordered:item.quantity-scanned,confirmedBy:picker,confirmedAt:new Date().toISOString()};
}
function validBackorder(record,orderId,item,scanned) {
  const proof=record?.caseBackorders?.[itemKey(item)];
  return !!proof && proof.orderId===orderId && proof.key===itemKey(item) && proof.ordered===item.quantity &&
    proof.scanned===scanned && proof.backordered===item.quantity-scanned && proof.backordered>0 &&
    Number.isSafeInteger(scanned) && scanned>=0 && !!proof.confirmedBy && Number.isFinite(Date.parse(proof.confirmedAt));
}
function confirmedCaseLines(source,essentials,readItemState) {
  return essentials.lineItems.map((item,index)=>{
    const scanned=Number(readItemState(essentials.record.itemScannedCount,item,index) || 0);
    if(!Number.isSafeInteger(scanned) || scanned<0 || scanned>item.quantity ||
      (scanned<item.quantity && !validBackorder(essentials.record,source.orderId,item,scanned))) throw Error('Every missing case must be explicitly confirmed on backorder');
    return {key:itemKey(item),ordered:item.quantity,shipped:scanned};
  });
}
function inspectOrders(orders,job) {
  const aggregate=new Map(), native=new Map(), totals=new Map(), ids=new Set();
  for(const order of orders) {
    if(!order || order.cancelledAt || !job.orderIds.includes(order.id) || ids.has(order.id) ||
       !Array.isArray(order.lineItems?.nodes) || order.lineItems.pageInfo?.hasNextPage ||
       !Array.isArray(order.fulfillments) || order.fulfillments.length>=100) throw Error('Complete, unchanged Shopify order evidence required');
    ids.add(order.id);
    const tags=[...(order.tags||[]),...(order.customer?.tags||[])].map(t=>String(t).trim().toLowerCase());
    const destinations=[...new Set(tags.filter(t=>t.startsWith('hummus fit ') && t!=='hummus fit store'))];
    if(destinations.length!==1 || destinations[0]!==POS_STORE_LOCATIONS[job.store]?.toLowerCase()) throw Error('Exact destination store required');
    for(const line of order.lineItems.nodes) {
      if(!/^gid:\/\/shopify\/LineItem\/\d+$/.test(line.id||'') || native.has(line.id) ||
        !Number.isSafeInteger(line.quantity) || line.quantity<1 || line.currentQuantity!==line.quantity) throw Error('Edited, refunded, or ambiguous order line needs review');
      const title=line.variantTitle && line.variantTitle.toLowerCase()!=='default title' ? `${line.title} — ${line.variantTitle}` : line.title;
      const key=itemKey({...line,title});
      native.set(line.id,{...line,key,orderId:order.id});
      const entry=aggregate.get(key)||{quantity:0,ids:[]}; entry.quantity+=line.quantity;entry.ids.push(line.id);aggregate.set(key,entry);
    }
    const seen=new Set();
    for(const f of order.fulfillments) {
      if(f.status!=='SUCCESS' || f.location?.id!==WAREHOUSE || !f.id || seen.has(f.id) ||
        !Array.isArray(f.fulfillmentLineItems?.nodes) || f.fulfillmentLineItems.pageInfo?.hasNextPage) throw Error('Fulfillment evidence needs warehouse review');
      seen.add(f.id);const lines=new Set();
      for(const entry of f.fulfillmentLineItems.nodes) {
        const id=entry.lineItem?.id;
        if(native.get(id)?.orderId!==order.id || lines.has(id) || !Number.isSafeInteger(entry.quantity) || entry.quantity<1) throw Error('Invalid fulfilled line');
        lines.add(id);totals.set(id,(totals.get(id)||0)+entry.quantity);
        if(totals.get(id)>native.get(id).quantity) throw Error('Fulfilled quantity exceeds order');
      }
    }
  }
  if(ids.size!==job.orderIds.length || aggregate.size!==job.items.length) throw Error('Picking snapshot does not match Shopify order set');
  const targets=new Map();
  for(const item of job.items) {
    const match=aggregate.get(item.key);
    if(!match || match.quantity!==item.ordered || !Number.isSafeInteger(item.shipped) || item.shipped<0 || item.shipped>item.ordered) throw Error('Order quantities changed since completion');
    if(item.shipped!==item.ordered && match.ids.length!==1) throw Error('Merged-order backorder needs exact line allocation; no shipment created');
    for(const id of match.ids) targets.set(id,item.shipped===item.ordered?native.get(id).quantity:item.shipped);
  }
  return {native,totals,targets};
}
function planOrder(order,evidence,job) {
  const {native,totals,targets}=evidence;
  const lines=[...native.values()].filter(l=>l.orderId===order.id);
  const satisfied=lines.every(l=>(totals.get(l.id)||0)>=targets.get(l.id));
  // A fully shipped line/backorder shipped later is evidence, never a reason
  // to resend the original completion or change inventory here.
  if(satisfied) return {done:true,fulfillmentIds:order.fulfillments.map(f=>f.id)};
  const partial=lines.some(l=>targets.get(l.id)<l.quantity);
  if((partial || order.fulfillments.length>0) && !PARTIAL_FULFILLMENT_STORES.includes(job.store)) throw Error('Backorder saved. Logistics must replace this store’s legacy inventory-credit step before partial fulfillment; no stock changed');
  if(order.fulfillmentOrders?.pageInfo?.hasNextPage || !Array.isArray(order.fulfillmentOrders?.nodes)) throw Error('Complete fulfillment orders required');
  const needed=new Map(lines.map(l=>[l.id,Math.max(0,targets.get(l.id)-(totals.get(l.id)||0))]));
  const input=[];
  for(const fo of order.fulfillmentOrders.nodes) {
    if(fo.lineItems?.pageInfo?.hasNextPage || !Array.isArray(fo.lineItems?.nodes)) throw Error('Complete fulfillment-order lines required');
    const selected=[];
    for(const row of fo.lineItems.nodes) {
      const want=needed.get(row.lineItem?.id)||0;
      if(!want || row.remainingQuantity===0) continue;
      if(!['OPEN','IN_PROGRESS'].includes(fo.status) || fo.assignedLocation?.location?.id!==WAREHOUSE ||
        !Number.isSafeInteger(row.remainingQuantity) || row.remainingQuantity<0) throw Error('Shipping Warehouse fulfillment is not ready');
      const quantity=Math.min(want,row.remainingQuantity);
      selected.push({id:row.id,quantity});needed.set(row.lineItem.id,want-quantity);
    }
    if(selected.length) input.push({fulfillmentOrderId:fo.id,fulfillmentOrderLineItems:selected});
  }
  if([...needed.values()].some(n=>n!==0) || !input.length) throw Error('Exact picked quantities are not fulfillable');
  return {done:false,fulfillment:{notifyCustomer:false,lineItemsByFulfillmentOrder:input}};
}
function createCompletionFulfillment({dir,query,durable=true}) {
  const file=path.join(dir,'completion-fulfillments-v1.json');
  // Serialize the entire writer: overlapping merged order sets must not race.
  let tail=Promise.resolve();
  const locked=fn=>{const next=tail.then(fn,fn);tail=next.catch(()=>{});return next;};
  function persist(key,job) {const all=read(file);all[key]=job;durableWrite(file,all);}
  function enqueue({store,source,caseLines,confirmedBy}) {
    if(!durable) throw Error('Persistent completion ledger unavailable; no Shopify write allowed');
    if(!canonicalStore(store) || source.isB2B || !confirmedBy) throw Error('Confirmed POS store completion required');
    const orderIds=[...new Set((source.orders||[]).map(o=>o.id))].sort();
    if(!orderIds.length || orderIds.some(id=>!/^gid:\/\/shopify\/Order\/\d+$/.test(id))) throw Error('Exact order identifiers required');
    const cases=new Map(caseLines.map(l=>[l.key,l]));
    const items=source.lineItems.map(item=>cases.get(itemKey(item))||{key:itemKey(item),ordered:item.quantity,shipped:item.quantity}).sort((a,b)=>a.key.localeCompare(b.key));
    if(new Set(items.map(i=>i.key)).size!==items.length) throw Error('Duplicate picking identity');
    const key=digest([store,orderIds]), fingerprint=digest(items), existing=read(file)[key];
    if(existing) {if(existing.fingerprint!==fingerprint) throw Error('Shipment already saved with different counts; review before changing it');return key;}
    for(const other of Object.values(read(file))) if(other.orderIds.some(id=>orderIds.includes(id))) throw Error('An overlapping shipment already exists; review it instead of creating another');
    persist(key,{key,fingerprint,store,orderIds,items,confirmedBy,confirmedAt:new Date().toISOString(),status:'queued',orders:{}});
    return key;
  }
  async function run(key) {return locked(async()=>{
    let job=read(file)[key];if(!job) throw Error('Saved completion not found');
    if(!durable) throw Error('Persistent completion ledger unavailable');
    try {
      let orders=await Promise.all(job.orderIds.map(async id=>(await query(ORDER_QUERY,{id})).order));
      let evidence=inspectOrders(orders,job);
      for(const order of orders) {
        const previous=job.orders[order.id]||{};
        const plan=planOrder(order,evidence,job);
        if(plan.done) {job.orders[order.id]={...previous,status:'verified',fulfillmentIds:plan.fulfillmentIds};persist(key,job);continue;}
        // Any request that might have reached Shopify is never sent twice,
        // even after a timeout, restart, manual change, or double-tap.
        if(previous.attemptedAt) throw Error('Shopify response uncertain or shipment changed. Retry checks proof only; logistics review required before any new shipment');
        job.orders[order.id]={status:'verifying',attemptedAt:new Date().toISOString(),input:plan.fulfillment};
        job.status='verifying';persist(key,job);
        const result=(await query(CREATE_MUTATION,{fulfillment:plan.fulfillment})).fulfillmentCreate;
        if(result?.userErrors?.length) throw Error(result.userErrors.map(e=>e.message).join('; '));
        if(!result?.fulfillment?.id || result.fulfillment.status!=='SUCCESS') throw Error('Shopify fulfillment response is not confirmed');
        job.orders[order.id].fulfillmentId=result.fulfillment.id;persist(key,job);
        const fresh=(await query(ORDER_QUERY,{id:order.id})).order;
        orders=orders.map(o=>o.id===order.id?fresh:o);evidence=inspectOrders(orders,job);
        if(!planOrder(fresh,evidence,job).done) throw Error('Shopify has not confirmed the exact shipment');
        job.orders[order.id].status='verified';persist(key,job);
      }
      job.status=[...evidence.native.values()].every(l=>(evidence.totals.get(l.id)||0)===l.quantity)?'fulfilled':'fulfilled_with_backorder';
      job.error=null;job.verifiedAt=new Date().toISOString();persist(key,job);
    } catch(e) {job.status='needs_review';job.error=e.message;persist(key,job);}
    return summary(job);
  });}
  function summary(job) {
    if(!job) return null;
    return {key:job.key,status:job.status,error:job.error||null,verifiedAt:job.verifiedAt||null,
      backorders:job.items.filter(i=>i.shipped<i.ordered).map(i=>({item:i.key,quantity:i.ordered-i.shipped})),
      orders:job.orderIds.map(id=>({orderId:id,ok:job.orders[id]?.status==='verified',...job.orders[id],input:undefined}))};
  }
  function status(store,orderId) {const ids=String(orderId).split(',').sort();return summary(read(file)[digest([store,ids])]);}
  return {enqueue,run,status,read:()=>read(file)};
}
module.exports={ORDER_QUERY,CREATE_MUTATION,backorderDecision,validBackorder,confirmedCaseLines,canonicalStore,inspectOrders,planOrder,createCompletionFulfillment};
