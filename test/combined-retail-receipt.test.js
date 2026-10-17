const test=require('node:test'),assert=require('node:assert/strict');
const {receiptOrderIds,savedReceiptBatches}=require('../combined-retail-receipt');
const {receiptKey}=require('../essentials-pos-conversion');
const cutoff=Date.parse('2026-10-06T04:00:00Z'),sku='HF-NYB-CELL-4905-C12';
function fixture(){
  const orders=[1,2].map(n=>({id:`gid://shopify/Order/${n}`,name:`#${n}`,createdAt:'2026-10-17T00:00:00Z',cancelledAt:null,
    displayFulfillmentStatus:'FULFILLED',customer:{tags:['Hummus Fit Ronkonkoma']},
    lineItems:{nodes:n===1?[{sku,quantity:2,variant:{product:{tags:['retail-essentials']}}}]:[],pageInfo:{hasNextPage:false}},
    fulfillments:[{status:'SUCCESS',location:{id:'gid://shopify/Location/103133642999'}}]}));
  const orderId=orders.map(o=>o.id).join(',');
  return {orders,orderId,counts:{[sku]:2},evidence:{id:'Ronkonkoma::receipt',store:'Ronkonkoma',orderId,orderName:'#1, #2',
    submittedAt:'2026-10-17T14:00:00Z',items:[{sku,orderedQty:2,expectedFromPicking:2,actuallyReceived:2}]},ledger:{}};
}
const run=f=>savedReceiptBatches('Ronkonkoma',f.orderId,f.counts,f.evidence,f.orders,cutoff,f.ledger);
test('combined receipt partitions to exact source and leaves food-only order untouched',()=>{
  const f=fixture(),out=run(f);assert.equal(out[0].lines[0].receivedCases,2);assert.deepEqual(out[1].lines,[]);
  assert.equal(receiptKey('Ronkonkoma',out[0].orderId,sku),receiptKey('Ronkonkoma',f.orders[0].id,sku));
});
test('reordered combined IDs and a single-order retry keep the original key',()=>{
  const f=fixture(),first=run(f)[0];f.orders.reverse();f.orderId=f.orders.map(o=>o.id).join(',');
  f.evidence.orderId=f.orderId;f.evidence.orderName='#2, #1';const again=run(f)[1];
  assert.equal(receiptKey('Ronkonkoma',first.orderId,sku),receiptKey('Ronkonkoma',again.orderId,sku));
  f.orders=[again.order];f.orderId=again.orderId;f.evidence.orderId=f.orderId;f.evidence.orderName='#1';
  assert.equal(run(f)[0].orderId,first.orderId);
});
test('wrong source, duplicate IDs/SKUs, incomplete evidence, and altered counts fail before writes',()=>{
  for(const change of [f=>f.orders[1].customer.tags=['Hummus Fit Bellmore'],f=>f.orders[1].displayFulfillmentStatus='UNFULFILLED',
    f=>f.orders[1].lineItems.nodes=[{...f.orders[0].lineItems.nodes[0]}],f=>f.evidence.items=[],f=>f.counts[sku]=3,
    f=>f.orders[1].fulfillments[0].location.id='gid://shopify/Location/1',f=>f.evidence.orderName='#2, #1',
    f=>f.evidence.items.push({...f.evidence.items[0]}),f=>f.counts.UNKNOWN=1]) {
    const f=fixture();change(f);assert.throws(()=>run(f));
  }
  for(const id of ['1','gid://shopify/Order/1,','gid://shopify/Order/1,gid://shopify/Order/1']) assert.throws(()=>receiptOrderIds(id));
});
test('legacy combined pending/posted/failed entries cannot create a second exact-order credit',()=>{
  for(const status of ['posted','pending','failed']) {const f=fixture();f.ledger.x={store:'Ronkonkoma',orderId:f.orderId,caseSku:sku,status};assert.throws(()=>run(f),/Legacy combined-order/);}
});
test('existing exact-order keys remain unchanged and unrelated ledger entries do not block',()=>{
  const f=fixture();f.ledger.x={store:'Ronkonkoma',orderId:f.orders[0].id,caseSku:sku,status:'posted'};
  assert.equal(run(f)[0].orderId,f.orders[0].id);
});
test('actual receipt endpoint uses exact keys across retry/restart and does not call food or picking',async()=>{
  const fs=require('node:fs'),vm=require('node:vm');
  const source=fs.readFileSync(require.resolve('../server'),'utf8');
  const route=source.slice(source.indexOf('app.post("/api/essentials-pos-receipt"'),source.indexOf('// Staff may identify an off-order barcode'));
  const ledger={},writes=[],f=fixture();
  const boot=()=>{
    let handler;
    vm.runInNewContext(route,{
      require:p=>require('../'+p.replace(/^\.\//,'')),console,Date,
      ESSENTIALS_POS_CONVERSION_ENABLED:true,ESSENTIALS_SEPARATION_ENABLED:true,
      POS_SHOPIFY_CLIENT_ID:'test',POS_SHOPIFY_CLIENT_SECRET:'test',ESSENTIALS_POS_CUTOVER:cutoff,
      verifyLogisticsToken:()=>({sub:'hummusfit-receiving'}),VALID_STOP_NAMES:new Map([['ronkonkoma',{isB2B:false}]]),
      POS_STORE_LOCATIONS:{Ronkonkoma:'Hummus Fit Ronkonkoma'},loadArchive:()=>({}),loadPosLedger:()=>ledger,
      shopifyGraphQL:async(q,v)=>{assert.match(v.id,/^gid:\/\/shopify\/Order\/\d+$/);return {order:f.orders.find(o=>o.id===v.id)};},
      exactStoreLocation:async()=> 'ronkonkoma-location',
      convertOneReceivedLine:async(store,id,location,line)=>{
        const key=receiptKey(store,id,line.caseSku);if(ledger[key]) return {sku:line.caseSku,status:'already_posted'};
        ledger[key]={store,orderId:id,caseSku:line.caseSku,status:'posted'};writes.push({id,location,units:line.receivedCases*line.unitsPerCase});
        return {sku:line.caseSku,status:'posted'};
      },
      app:{post:(path,fn)=>{handler=fn;}},
    });return handler;
  };
  async function invoke(handler){let result,status=200;await handler({get:()=> 'Bearer test',body:{store:'Ronkonkoma',orderId:f.orderId,receivedCounts:f.counts,receiptEvidence:f.evidence}},
    {status:n=>{status=n;return {json:r=>{result=r;}};},json:r=>{result=r;}});return {status,result};}
  assert.equal((await invoke(boot())).result.results[0].status,'posted');
  assert.equal((await invoke(boot())).result.results[0].status,'already_posted');
  assert.deepEqual(writes,[{id:'gid://shopify/Order/1',location:'ronkonkoma-location',units:24}]);
});
