const {deliveryDate,orderKey}=require('./receiving-selection');
const {POS_STORE_LOCATIONS}=require('./essentials-pos-conversion');
const {essentialsTypeFor}=require('./essentials-shadow');
const QUERY=`query ReceivingFulfilledPick($id:ID!){order(id:$id){id name createdAt cancelledAt displayFulfillmentStatus customer{tags} lineItems(first:250){nodes{id title variantTitle sku quantity variant{id barcode image{url} product{tags featuredImage{url} collections(first:100){nodes{title handle} pageInfo{hasNextPage}}}}} pageInfo{hasNextPage}} fulfillments(first:100){id createdAt status location{id} fulfillmentLineItems(first:250){nodes{quantity lineItem{id}} pageInfo{hasNextPage}}}}}`;
const easternDateFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});

function recoveryOrderIds(value){
  const ids=String(value||'').split(',').map(id=>id.trim());
  if(!ids.length||ids.length>20||new Set(ids).size!==ids.length||ids.some(id=>!/^gid:\/\/shopify\/Order\/\d+$/.test(id)))return null;
  return ids.sort();
}

// Shipping must prove every quantity on every exact order. Food and
// Essentials retain their own physical counts even if Finish was never saved.
// Recovery derives a receiving manifest; it never writes picking or inventory.
function recoverFulfilledDelivery(orders,records,store,now=new Date(),separationEnabled=true){
  const fail=()=>new Error('The shipped order and saved picking counts could not be verified for receiving.');
  if(!Array.isArray(orders)||!orders.length||orders.length>20||!POS_STORE_LOCATIONS[store])throw fail();
  orders=[...orders].sort((a,b)=>String(a?.id).localeCompare(String(b?.id)));
  const ids=recoveryOrderIds(orders.map(o=>o?.id).join(','));
  if(!ids)throw fail();
  const identity=ids.join(','),today=easternDateFormatter.format(now);
  const matching=record=>record&&orderKey(record.orderId)===identity?record:null;
  const foodRecord=matching(records?.picking),essentialsRecord=matching(records?.essentials);
  const merged=new Map(),skuKeys=new Map(),fulfillmentTimes=[];
  for(const order of orders){
    if(order.cancelledAt||order.displayFulfillmentStatus!=='FULFILLED'||order.lineItems?.pageInfo?.hasNextPage||
        !order.lineItems?.nodes?.length||!order.fulfillments?.length)throw fail();
    const tags=(order.customer?.tags||[]).map(t=>t.toLowerCase());
    const destinations=Object.keys(POS_STORE_LOCATIONS).filter(s=>tags.includes('hummus fit '+s.toLowerCase())||(s==='Islip'&&tags.includes('hummus fit east islip')));
    if(destinations.length!==1||destinations[0]!==store)throw fail();
    const shipped=new Map(),lineIds=new Set(order.lineItems.nodes.map(i=>i.id));
    if(lineIds.size!==order.lineItems.nodes.length)throw fail();
    for(const f of order.fulfillments){
      if(f.status!=='SUCCESS'||f.location?.id!=='gid://shopify/Location/103133642999'||f.fulfillmentLineItems?.pageInfo?.hasNextPage||
          !Number.isFinite(Date.parse(f.createdAt))||Date.parse(f.createdAt)>now.getTime())throw fail();
      fulfillmentTimes.push(f.createdAt);
      for(const l of f.fulfillmentLineItems?.nodes||[]){
        if(!lineIds.has(l.lineItem?.id)||!Number.isSafeInteger(l.quantity)||l.quantity<1)throw fail();
        shipped.set(l.lineItem.id,(shipped.get(l.lineItem.id)||0)+l.quantity);
      }
    }
    for(const item of order.lineItems.nodes){
      const title=item.variantTitle&&item.variantTitle.toLowerCase()!=='default title'?item.title+' — '+item.variantTitle:item.title;
      // Food and supply lines can have no SKU. Their exact Shopify line and
      // variant IDs, warehouse fulfillment, title, and saved count still gate recovery.
      const sku=item.sku||'';
      const key=title+'::'+sku;
      if(!title||!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(item.variant?.id||'')||!item.variant?.product||!Array.isArray(item.variant.product.tags)||
          !Number.isSafeInteger(item.quantity)||item.quantity<1||shipped.get(item.id)!==item.quantity||
          item.variant.product.collections?.pageInfo?.hasNextPage||
          (sku&&skuKeys.has(sku)&&skuKeys.get(sku)!==key))throw fail();
      if(sku)skuKeys.set(sku,key);
      const line={title,sku,variantId:item.variant.id,quantity:item.quantity,imageUrl:item.variant.image?.url||item.variant.product.featuredImage?.url||null,
        productTags:item.variant.product.tags,productCollections:item.variant.product.collections?.nodes||[],scanCodes:[item.sku,item.variant.barcode].filter(Boolean)};
      if(merged.has(key)){
        const prior=merged.get(key);
        if(prior.variantId!==line.variantId||essentialsTypeFor(prior)!==essentialsTypeFor(line))throw fail();
        prior.quantity+=line.quantity;
      }else merged.set(key,line);
    }
  }
  // A store's morning delivery can include an add-on order placed before the
  // previous day's noon cutoff. Accept that mixed batch only when another
  // order is scheduled for today and every exact warehouse fulfillment was
  // completed today. Older or unfulfilled batches remain unavailable.
  const scheduledDays=orders.map(deliveryDate);
  const scheduledToday=scheduledDays.every(day=>day===today);
  const yesterday=new Date(Date.parse(`${today}T00:00:00Z`)-86400000).toISOString().slice(0,10);
  const verifiedCarryover=scheduledDays.includes(today)&&scheduledDays.some(day=>day===yesterday)&&
    scheduledDays.every(day=>day===today||day===yesterday)&&
    fulfillmentTimes.every(time=>easternDateFormatter.format(new Date(time))===today);
  if(!scheduledToday&&!verifiedCarryover)throw fail();
  const lineItems=[...merged.values()],foodKeys=new Set(),essentialsKeys=new Set();
  for(const item of lineItems){
    const key=item.title+'::'+item.sku;
    const essential=separationEnabled&&Boolean(essentialsTypeFor(item));
    const record=essential?essentialsRecord:foodRecord;
    if(!Number.isSafeInteger(item.quantity)||!record||record.itemStatus?.[key]!=='picked'||record.itemScannedCount?.[key]!==item.quantity)throw fail();
    (essential?essentialsKeys:foodKeys).add(key);
  }
  for(const [record,keys] of [[foodRecord,foodKeys],[essentialsRecord,essentialsKeys]]){
    if(keys.size&&Object.keys(record.itemStatus||{}).some(key=>!keys.has(key)))throw fail();
  }
  const verifiedAt=fulfillmentTimes.sort().at(-1),primary=foodKeys.size?foodRecord:essentialsRecord;
  return {deliveryDate:today,source:{orderId:identity,orderName:orders.map(o=>o.name).join(', '),createdAt:orders.map(o=>o.createdAt).sort()[0],
      orders:orders.map(o=>({id:o.id,name:o.name,createdAt:o.createdAt})),lineItems,isB2B:false},
    record:{...primary,orderId:identity,completedAt:verifiedAt},
    essentialsRecord:essentialsKeys.size?{...essentialsRecord,orderId:identity,completedAt:verifiedAt}:null,
    shipmentVerifiedAt:verifiedAt};
}

// Keep the single-workflow interface for existing callers and tests.
function recoverFulfilledPick(order,record,store,now=new Date()){
  return recoverFulfilledDelivery([order],{picking:record},store,now,false);
}

async function automaticFulfilledDelivery({selected,records,store,query,now=new Date(),separationEnabled=true,onError=()=>{}}){
  const candidates=new Set(),loaded=new Map();
  for(const record of [records?.picking,records?.essentials]){
    const ids=recoveryOrderIds(record?.orderId);
    if(ids)candidates.add(ids.join(','));
  }
  for(const identity of candidates){
    if(selected&&orderKey(selected.source.orderId)===identity)continue;
    try{
      const orders=[];
      for(const id of identity.split(',')){
        if(!loaded.has(id))loaded.set(id,(await query(QUERY,{id},'2026-07')).order);
        orders.push(loaded.get(id));
      }
      const recovered=recoverFulfilledDelivery(orders,records,store,now,separationEnabled);
      if(!selected||Date.parse(recovered.shipmentVerifiedAt)>Date.parse(selected.record.completedAt))selected=recovered;
    }catch(error){onError(error);}
  }
  return selected;
}
module.exports={QUERY,recoverFulfilledPick,recoverFulfilledDelivery,automaticFulfilledDelivery,recoveryOrderIds};
