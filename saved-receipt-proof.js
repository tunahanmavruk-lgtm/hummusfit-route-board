const {caseMapping,POS_STORE_LOCATIONS}=require('./essentials-pos-conversion');

// A new completed delivery can replace the stop's latest archive. An older
// receipt must use its own saved evidence, never the new delivery's pick data.
function savedReceiptLines(store,orderId,counts,evidence,order,cutover) {
  if(!POS_STORE_LOCATIONS[store] || !evidence || evidence.store!==store || evidence.orderId!==orderId ||
    !String(evidence.id||'').startsWith(store+'::') || !Number.isFinite(Date.parse(evidence.submittedAt)) ||
    Date.parse(evidence.submittedAt)<cutover || !order || order.id!==orderId || order.name!==evidence.orderName ||
    order.displayFulfillmentStatus!=='FULFILLED' || order.cancelledAt ||
    !Number.isFinite(Date.parse(order.createdAt)) || Date.parse(order.createdAt)<cutover ||
    order.lineItems?.pageInfo?.hasNextPage || !order.fulfillments?.length ||
    !order.fulfillments.every(f=>f.status==='SUCCESS' && f.location?.id==='gid://shopify/Location/103133642999')) {
    throw new Error('Exact saved post-cutover receipt and Shipping Warehouse fulfillment required');
  }
  const tags=(order.customer?.tags||[]).map(t=>t.toLowerCase());
  const destinations=Object.keys(POS_STORE_LOCATIONS).filter(s=>tags.includes('hummus fit '+s.toLowerCase()) || (s==='Islip'&&tags.includes('hummus fit east islip')));
  if(destinations.length!==1 || destinations[0]!==store) throw new Error('Shopify order destination differs from saved receipt');
  const retail=order.lineItems.nodes.filter(i=>(i.variant?.product?.tags||[]).includes('retail-essentials'));
  if(!Array.isArray(evidence.items) || !counts || new Set(retail.map(i=>i.sku)).size!==retail.length ||
    retail.length!==evidence.items.length || retail.length!==Object.keys(counts).length) throw new Error('Complete unique retail receipt required');
  return retail.map(item=>{
    const matches=evidence.items.filter(i=>i.sku===item.sku);
    const saved=matches[0];
    if(matches.length!==1 || !item.sku || saved.orderedQty!==item.quantity ||
      !Number.isSafeInteger(saved.actuallyReceived) || saved.actuallyReceived<0 ||
      saved.actuallyReceived!==saved.expectedFromPicking || saved.actuallyReceived!==counts[item.sku] ||
      !(saved.actuallyReceived===item.quantity || saved.actuallyReceived===0)) throw new Error('Saved retail quantities do not match exact Shopify order');
    const mapping=caseMapping({...item,productTags:item.variant.product.tags});
    return {...mapping,title:item.title,pickedCases:saved.expectedFromPicking,receivedCases:saved.actuallyReceived};
  });
}
module.exports={savedReceiptLines};
