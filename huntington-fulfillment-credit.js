const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { deliveredQuantities, LOCATION } = require('./huntington-fulfillment');
const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const read = file => { try { const r = JSON.parse(fs.readFileSync(file, 'utf8')); if (!r || Array.isArray(r)) throw new Error('Invalid credit ledger'); return r; } catch(e) { if(e.code === 'ENOENT') return {}; throw e; } };
const STOCK_QUERY = `query HuntingtonCreditStock($id:ID!,$locationId:ID!){inventoryItem(id:$id){id sku tracked inventoryLevel(locationId:$locationId){quantities(names:["available"]){name quantity}}}}`;
function verifyCredit(group, entry) {
  const changes = (group?.changes || []).filter(c => c.name === 'available');
  if (!/^gid:\/\/shopify\/InventoryAdjustmentGroup\/\d+$/.test(group?.id || '') ||
      group.referenceDocumentUri !== entry.input.referenceDocumentUri || changes.length !== 1 ||
      changes[0].item?.id !== entry.inventoryItemId || changes[0].location?.id !== LOCATION ||
      changes[0].delta !== entry.quantity) throw new Error('Exact Huntington fulfillment credit proof does not match');
}
function createFulfillmentCredit({dir, orderQuery, inventoryQuery, orderQueryText, groupQuery, adjustMutation, now=Date.now}) {
  const file = path.join(dir, 'huntington-fulfillment-credits-v1.json'), flights = new Map();
  function write(key, value) { const all = read(file); all[key] = value; const tmp = file+'.tmp'; fs.writeFileSync(tmp, JSON.stringify(all,null,2)); fs.renameSync(tmp,file); }
  async function credit({store, orderId, fulfillmentId, lineItemId}) {
    if (store !== 'Huntington' || !/^gid:\/\/shopify\/Order\/\d+$/.test(orderId || '') ||
        !/^gid:\/\/shopify\/Fulfillment\/\d+$/.test(fulfillmentId || '') ||
        !/^gid:\/\/shopify\/LineItem\/\d+$/.test(lineItemId || '')) throw new Error('Exact Huntington fulfillment identifiers required');
    const key=hash(['huntington-fulfillment-v1', orderId, fulfillmentId, lineItemId, LOCATION]);
    if(flights.has(key)) return flights.get(key);
    const promise=(async()=>{
      const {order}=await orderQuery(orderQueryText,{id:orderId});
      if(order?.id!==orderId) throw new Error('Exact order required');
      deliveredQuantities(order);
      const fulfillment=order.fulfillments.find(f=>f.id===fulfillmentId);
      if(!fulfillment) throw new Error('Fulfillment does not belong to order');
      const fulfilled=fulfillment.fulfillmentLineItems.nodes.find(l=>l.lineItem.id===lineItemId);
      // The Flow loop can include unshipped lines; these MUST do nothing.
      if(!fulfilled) return {ok:true,status:'not_in_fulfillment',lineItemId};
      const line=order.lineItems.nodes.find(l=>l.id===lineItemId), inventoryItemId=line.variant?.inventoryItem?.id;
      if(!line.sku || !/^gid:\/\/shopify\/InventoryItem\/\d+$/.test(inventoryItemId||'')) return {ok:true,status:'receipt_only',lineItemId};
      const legacy=Object.values(read(path.join(dir,'store-flow-credit-proofs.json'))).filter(e=>e.orderId===orderId&&e.lineItemId===lineItemId);
      if(legacy.length) throw new Error('Existing legacy Flow credit requires reconciliation; no additional credit sent');
      let entry=read(file)[key];
      if(entry && (entry.quantity!==fulfilled.quantity || entry.inventoryItemId!==inventoryItemId || entry.sku!==line.sku)) throw new Error('Fulfillment changed after credit started');
      if(!entry) {
        const stock=(await inventoryQuery(STOCK_QUERY,{id:inventoryItemId,locationId:LOCATION})).inventoryItem;
        const available=stock?.inventoryLevel?.quantities?.find(q=>q.name==='available')?.quantity;
        if(stock?.id!==inventoryItemId||stock.sku!==line.sku||stock.tracked!==true||!Number.isSafeInteger(available)) throw new Error('Destination inventory identity or activation needs review');
        entry={status:'pending',orderId,fulfillmentId,lineItemId,sku:line.sku,inventoryItemId,quantity:fulfilled.quantity,startedAt:now(),key,
          input:{name:'available',reason:'correction',referenceDocumentUri:`gid://agent-hazar-receiving/FulfillmentCredit/${key}`,
            changes:[{inventoryItemId,locationId:LOCATION,delta:fulfilled.quantity,changeFromQuantity:available}]}};
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
    const totals=deliveredQuantities(order);
    if(totals.get(line.id)!==line.quantity) throw new Error('This line is not fully delivered');
    const expected=order.fulfillments.flatMap(f=>f.fulfillmentLineItems.nodes.filter(l=>l.lineItem.id===line.id).map(l=>({f,l})));
    for(const {f,l}of expected) {
      const key=hash(['huntington-fulfillment-v1',order.id,f.id,line.id,LOCATION]);
      const entry=read(file)[key];
      if(entry?.status!=='posted'||entry.quantity!==l.quantity||entry.inventoryItemId!==line.variant?.inventoryItem?.id) throw new Error('Waiting for exact delivered-line store credit proof');
      verifyCredit((await inventoryQuery(groupQuery,{id:entry.adjustmentId})).node,entry);
    }
    return true;
  }
  return {credit,verifyLine};
}
module.exports={createFulfillmentCredit,verifyCredit,STOCK_QUERY};
