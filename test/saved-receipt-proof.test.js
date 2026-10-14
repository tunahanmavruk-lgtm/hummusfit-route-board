const test=require('node:test'),assert=require('node:assert/strict');
const {savedReceiptLines}=require('../saved-receipt-proof');
const cutoff=Date.parse('2026-10-06T04:00:00Z');
function fixture(){return {store:'Selden',orderId:'gid://shopify/Order/123',counts:{'HF-NYB-CELL-4905-C12':1},evidence:{id:'Selden::1',store:'Selden',orderId:'gid://shopify/Order/123',orderName:'#123',submittedAt:'2026-10-12T13:00:00Z',items:[{sku:'HF-NYB-CELL-4905-C12',orderedQty:1,expectedFromPicking:1,actuallyReceived:1}]},order:{id:'gid://shopify/Order/123',name:'#123',createdAt:'2026-10-11T13:00:00Z',displayFulfillmentStatus:'FULFILLED',cancelledAt:null,customer:{tags:['Hummus Fit Selden']},lineItems:{pageInfo:{hasNextPage:false},nodes:[{sku:'HF-NYB-CELL-4905-C12',title:'Bloom',quantity:1,variant:{product:{tags:['retail-essentials']}}}]},fulfillments:[{status:'SUCCESS',location:{id:'gid://shopify/Location/103133642999'}}]}};}
const run=f=>savedReceiptLines(f.store,f.orderId,f.counts,f.evidence,f.order,cutoff);
test('old saved receipt resolves its own exact Shopify order without latest-stop archive',()=>{const lines=run(fixture());assert.equal(lines[0].unitsPerCase,12);assert.equal(lines[0].receivedCases,1);});
test('wrong stores, warehouse, fulfillment, dates, IDs and changed counts fail closed',()=>{
  for(const mutate of [f=>f.store='Brookfield',f=>f.order.customer.tags=['Hummus Fit Holbrook'],f=>f.order.customer.tags.push('Hummus Fit Holbrook'),f=>f.order.fulfillments[0].location.id='gid://shopify/Location/1',f=>f.order.displayFulfillmentStatus='UNFULFILLED',f=>f.evidence.submittedAt='2026-10-05T13:00:00Z',f=>f.order.createdAt='2026-10-05T13:00:00Z',f=>f.order.id='wrong',f=>f.counts['HF-NYB-CELL-4905-C12']=2,f=>f.order.lineItems.pageInfo.hasNextPage=true,f=>f.evidence.items.push({...f.evidence.items[0]})]){
    const f=fixture();mutate(f);assert.throws(()=>run(f));
  }
});
test('zero picked and zero received is receipt-only, never invented unit stock',()=>{const f=fixture();f.evidence.items[0].expectedFromPicking=0;f.evidence.items[0].actuallyReceived=0;f.counts['HF-NYB-CELL-4905-C12']=0;assert.equal(run(f)[0].receivedCases,0);});
test('collection-only retail uses the same classification as receiving',()=>{
  const f=fixture(),product=f.order.lineItems.nodes[0].variant.product;
  product.tags=['hidden'];product.collections={nodes:[{title:'Retail Essentials',handle:'retail-essentials'}],pageInfo:{hasNextPage:false}};
  assert.equal(run(f)[0].unitsPerCase,12);
  product.collections.pageInfo.hasNextPage=true;assert.throws(()=>run(f),/Complete product classification/);
});
test('product name or known SKU alone never authorizes a conversion',()=>{
  const f=fixture();f.order.lineItems.nodes[0].variant.product.tags=[];
  assert.throws(()=>run(f),/Complete unique retail/);
});
