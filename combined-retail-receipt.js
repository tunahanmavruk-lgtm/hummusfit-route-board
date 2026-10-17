const {savedReceiptLines}=require('./saved-receipt-proof');
const {essentialsTypeFor}=require('./essentials-shadow');

function receiptOrderIds(orderId) {
  const ids=String(orderId||'').split(',').map(id=>id.trim());
  if(!ids.length||ids.length>10||new Set(ids).size!==ids.length||
      ids.some(id=>!/^gid:\/\/shopify\/Order\/\d+$/.test(id))) {
    throw new Error('Distinct exact Shopify order IDs required');
  }
  return ids;
}

// Partition only unambiguous retail SKUs. A combined display ID is never an
// inventory idempotency key: retries, reordered IDs, and single-order receipts
// must converge on the same existing (store, exact order, SKU) key.
function savedReceiptBatches(store,orderId,counts,evidence,orders,cutover,ledger={}) {
  const ids=receiptOrderIds(orderId);
  if(ids.length===1) return [{orderId:ids[0],order:orders[0],
    lines:savedReceiptLines(store,orderId,counts,evidence,orders[0],cutover)}];
  const names=String(evidence?.orderName||'').split(',').map(n=>n.trim());
  if(evidence?.store!==store||evidence?.orderId!==orderId||orders.length!==ids.length||
      names.length!==ids.length||!Array.isArray(evidence?.items)||
      !counts||typeof counts!=='object'||Array.isArray(counts)||
      new Set(evidence.items.map(i=>i.sku)).size!==evidence.items.length) {
    throw new Error('Complete unique combined retail receipt required');
  }
  const owners=new Map();
  orders.forEach((order,index)=>{
    if(order?.id!==ids[index]||order.name!==names[index]||!Array.isArray(order.lineItems?.nodes)) {
      throw new Error('Combined receipt order identity mismatch');
    }
    for(const item of order.lineItems.nodes) {
      const product=item.variant?.product;
      if(essentialsTypeFor({...item,productTags:product?.tags,productCollections:product?.collections?.nodes})!=='retail') continue;
      if(!item.sku||owners.has(item.sku)) throw new Error('Retail SKU occurs on multiple order lines; explicit allocation required');
      owners.set(item.sku,index);
    }
  });
  if(owners.size!==evidence.items.length||owners.size!==Object.keys(counts).length||
      evidence.items.some(i=>!owners.has(i.sku))||Object.keys(counts).some(sku=>!owners.has(sku))) {
    throw new Error('Combined receipt does not cover exact retail order lines');
  }
  // Fail closed on any legacy combined-key write, including uncertain requests.
  // An operator must reconcile its Shopify proof before changing key identity.
  for(const entry of Object.values(ledger)) {
    if(entry.store!==store||!owners.has(entry.caseSku)||!String(entry.orderId||'').includes(',')) continue;
    if(String(entry.orderId).split(',').some(id=>ids.includes(id.trim()))) {
      throw new Error('Legacy combined-order conversion requires Shopify reconciliation');
    }
  }
  // Validate EVERY source order, even one containing only food, before any write.
  return orders.map((order,index)=>{
    const items=evidence.items.filter(i=>owners.get(i.sku)===index);
    const subset=Object.fromEntries(items.map(i=>[i.sku,counts[i.sku]]));
    const ownEvidence={...evidence,orderId:order.id,orderName:order.name,items};
    return {orderId:order.id,order,lines:savedReceiptLines(store,order.id,subset,ownEvidence,order,cutover)};
  });
}
module.exports={receiptOrderIds,savedReceiptBatches};
