const {deliveryDate}=require('./receiving-selection');
const {POS_STORE_LOCATIONS}=require('./essentials-pos-conversion');
const QUERY=`query ReceivingFulfilledPick($id:ID!){order(id:$id){id name createdAt cancelledAt displayFulfillmentStatus customer{tags} lineItems(first:250){nodes{id title variantTitle sku quantity variant{barcode image{url} product{tags featuredImage{url} collections(first:100){nodes{title handle} pageInfo{hasNextPage}}}}} pageInfo{hasNextPage}} fulfillments(first:100){id createdAt status location{id} fulfillmentLineItems(first:250){nodes{quantity lineItem{id}} pageInfo{hasNextPage}}}}}`;

// A Shopify fulfillment may remove an order from the feed before the picker
// presses Finish. Recover only when every saved physical scan agrees with the
// exact, fully shipped warehouse order. This never writes picking or inventory.
function recoverFulfilledPick(order,record,store,now=new Date()){
  const fail=()=>new Error('The shipped order and saved picking counts could not be verified for receiving.');
  if(!order||order.id!==record?.orderId||order.cancelledAt||order.displayFulfillmentStatus!=='FULFILLED'||
      !/^gid:\/\/shopify\/Order\/\d+$/.test(order.id)||order.lineItems?.pageInfo?.hasNextPage||
      !order.lineItems?.nodes?.length||!order.fulfillments?.length||deliveryDate(order)!==new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now))throw fail();
  const tags=(order.customer?.tags||[]).map(t=>t.toLowerCase());
  const destinations=Object.keys(POS_STORE_LOCATIONS).filter(s=>tags.includes('hummus fit '+s.toLowerCase())||(s==='Islip'&&tags.includes('hummus fit east islip')));
  if(destinations.length!==1||destinations[0]!==store)throw fail();
  const shipped=new Map();
  for(const f of order.fulfillments){
    if(f.status!=='SUCCESS'||f.location?.id!=='gid://shopify/Location/103133642999'||f.fulfillmentLineItems?.pageInfo?.hasNextPage||!Number.isFinite(Date.parse(f.createdAt))||Date.parse(f.createdAt)>now.getTime())throw fail();
    for(const l of f.fulfillmentLineItems?.nodes||[]){if(!Number.isSafeInteger(l.quantity)||l.quantity<1)throw fail();shipped.set(l.lineItem.id,(shipped.get(l.lineItem.id)||0)+l.quantity);}
  }
  const keys=new Set(),skus=new Set();
  const lineItems=order.lineItems.nodes.map(i=>{
    const title=i.variantTitle&&i.variantTitle.toLowerCase()!=='default title'?i.title+' — '+i.variantTitle:i.title;
    const key=title+'::'+(i.sku||'');
    if(!i.variant?.product||!Array.isArray(i.variant.product.tags)||!i.sku||keys.has(key)||skus.has(i.sku)||!Number.isSafeInteger(i.quantity)||i.quantity<1||shipped.get(i.id)!==i.quantity||
        record.itemStatus?.[key]!=='picked'||record.itemScannedCount?.[key]!==i.quantity||i.variant?.product?.collections?.pageInfo?.hasNextPage)throw fail();
    keys.add(key);skus.add(i.sku);
    return {title,sku:i.sku,quantity:i.quantity,imageUrl:i.variant?.image?.url||i.variant?.product?.featuredImage?.url||null,
      productTags:i.variant?.product?.tags||[],productCollections:i.variant?.product?.collections?.nodes||[],scanCodes:[i.sku,i.variant?.barcode].filter(Boolean)};
  });
  if(Object.keys(record.itemStatus||{}).some(k=>!keys.has(k)))throw fail();
  const verifiedAt=order.fulfillments.map(f=>f.createdAt).sort().at(-1);
  return {source:{orderId:order.id,orderName:order.name,createdAt:order.createdAt,lineItems,isB2B:false},
    record:{...record,completedAt:verifiedAt},essentialsRecord:null,shipmentVerifiedAt:verifiedAt};
}
module.exports={QUERY,recoverFulfilledPick};
