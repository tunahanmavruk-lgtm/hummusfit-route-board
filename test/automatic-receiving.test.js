const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createAutomaticReceiving,RELEASE}=require('../automatic-receiving');
const {POS_STORE_LOCATIONS}=require('../essentials-pos-conversion');
const gid=(k,id)=>`gid://shopify/${k}/${id}`;
function setup(t,store='Holbrook') {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hf-auto-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const product={status:'ACTIVE',tags:[],collections:{nodes:[],pageInfo:{hasNextPage:false}}};
  const order={id:gid('Order',1),name:'#1',createdAt:'2026-10-13T10:00:00Z',displayFulfillmentStatus:'FULFILLED',
    customer:{tags:[POS_STORE_LOCATIONS[store]]},tags:[],fulfillments:[{status:'SUCCESS',location:{id:gid('Location',103133642999)}}],
    lineItems:{pageInfo:{hasNextPage:false},nodes:[{id:gid('LineItem',2),sku:'WRAP',quantity:7,
      variant:{id:gid('ProductVariant',3),inventoryItem:{id:gid('InventoryItem',4)},product}}]}};
  const report={id:`${store}::1`,store,orderId:order.id,orderName:order.name,submittedAt:'2026-10-13T20:22:00Z',
    automation:{version:RELEASE},items:[{sku:'WRAP',orderedQty:7,actuallyReceived:0,orderDiff:-7,receivingCategory:'food'}],extraItems:[]};
  const locationId=gid('Location',10),groups=new Map(),mutations=[],keys=new Map();
  const credit={id:gid('InventoryAdjustmentGroup',5),createdAt:'2026-10-13T20:23:00Z',reason:'correction',referenceDocumentUri:order.id,
    app:{id:gid('App',7)},changes:[{name:'available',delta:7,item:{id:gid('InventoryItem',4),sku:'WRAP'},location:{id:locationId}}]};groups.set(credit.id,credit);
  let failAfterWrite=false,stale=false,clock=Date.parse('2026-10-13T20:24:00Z');
  const deps={dir,env:{HOLBROOK_FLOW_APP_ID:gid('App',7)},now:()=>clock,orderQuery:async()=>({order}),exactLocation:async()=>locationId,
    inventoryQuery:async(query,v)=>{
      if(query.includes('AutomaticReceiptGroup')) return {node:groups.get(v.id)};
      if(query.includes('AutomaticReceiptVariant')) {const extra=v.id===gid('ProductVariant',33);return {productVariant:{id:v.id,sku:extra?'BOWL':'WRAP',barcode:extra?'123456789012':'234567890123',product,
        inventoryItem:{id:gid('InventoryItem',extra?44:4),sku:extra?'BOWL':'WRAP',tracked:true,inventoryLevel:{quantities:[{name:'available',quantity:12}]}}}};}
      if(query.includes('AutomaticReceiptCorrection')) {
        mutations.push(v);
        if(stale){stale=false;return{inventoryAdjustQuantities:{userErrors:[{code:'CHANGE_FROM_QUANTITY_STALE',message:'changed'}]}};}
        let group=keys.get(v.key);
        if(!group){group={id:gid('InventoryAdjustmentGroup',100+keys.size),createdAt:'2026-10-13T20:24:00Z',referenceDocumentUri:v.input.referenceDocumentUri,
          changes:v.input.changes.map(c=>({name:'available',delta:c.delta,item:{id:c.inventoryItemId,sku:c.inventoryItemId===gid('InventoryItem',4)?'WRAP':'BOWL'},location:{id:c.locationId}}))};keys.set(v.key,group);groups.set(group.id,group);}
        if(failAfterWrite){failAfterWrite=false;throw new Error('lost response');}
        return {inventoryAdjustQuantities:{inventoryAdjustmentGroup:{id:group.id},userErrors:[]}};
      }
      throw new Error('Unexpected query');
    }};
  const service=createAutomaticReceiving(deps);
  return{dir,service,deps,report,order,product,credit,groups,mutations,keys,locationId,
    timeout:()=>{failAfterWrite=true;},stale:()=>{stale=true;},advance:()=>{clock+=3600001;},
    proof:()=>service.flowProof({store,orderId:order.id,lineItemId:gid('LineItem',2),adjustmentGroupId:credit.id},store==='Holbrook')};
}
test('all 14 stores: original credit, signed shortage, exact location, retry posts once',async t=>{
  for(const store of Object.keys(POS_STORE_LOCATIONS)) {
    const f=setup(t,store);await f.proof();
    assert.equal((await f.service.reconcile(f.report)).results[0].status,'posted');
    assert.equal((await f.service.reconcile(f.report)).results[0].status,'posted');
    assert.equal(f.mutations.length,1);assert.equal(f.mutations[0].input.changes[0].delta,-7);
    assert.equal(f.mutations[0].input.changes[0].locationId,f.locationId);
  }
});
test('missing Flow proof retries without writing; later proof unblocks',async t=>{
  const f=setup(t);assert.equal((await f.service.reconcile(f.report)).results[0].status,'retry');assert.equal(f.mutations.length,0);
  await f.proof();assert.equal((await f.service.reconcile(f.report)).results[0].status,'posted');
});
test('wrong food replaced by scanned extra food corrects both exact deltas',async t=>{
  const f=setup(t);await f.proof();f.report.extraItems=[{sku:'BOWL',qty:7,code:'123456789012',variantId:gid('ProductVariant',33),source:'scan',catalogVerified:true,catalogStatus:'matched'}];
  const r=await f.service.reconcile(f.report);assert.deepEqual(r.results.map(x=>x.status),['posted','posted']);assert.deepEqual(f.mutations.map(x=>x.input.changes[0].delta),[-7,7]);
});
test('typed unknown extra is held but valid shortage posts',async t=>{
  const f=setup(t);await f.proof();f.report.extraItems=[{sku:'BOWL',qty:7,code:'bowl',source:'manual'}];
  assert.deepEqual((await f.service.reconcile(f.report)).results.map(x=>x.status),['posted','requires_review']);assert.equal(f.mutations.length,1);
});
test('handheld barcode entry must pass the same exact catalog and quantity proof',async t=>{
  const f=setup(t);await f.proof();f.report.extraItems=[{sku:'BOWL',qty:2,code:'123456789012',variantId:gid('ProductVariant',33),source:'entered',catalogVerified:true,catalogStatus:'matched'}];
  assert.deepEqual((await f.service.reconcile(f.report)).results.map(x=>x.status),['posted','posted']);
});
test('lost response retries identical persisted key and input after restart',async t=>{
  const f=setup(t);await f.proof();f.timeout();assert.equal((await f.service.reconcile(f.report)).results[0].status,'retry');
  const restarted=createAutomaticReceiving(f.deps);assert.equal((await restarted.reconcile(f.report)).results[0].status,'posted');
  assert.equal(f.keys.size,1);assert.deepEqual(f.mutations[0],f.mutations[1]);
});
test('known CAS rejection alone permits fresh attempt; uncertain expired request is held',async t=>{
  const f=setup(t);await f.proof();f.stale();assert.equal((await f.service.reconcile(f.report)).results[0].status,'retry');
  assert.equal((await f.service.reconcile(f.report)).results[0].status,'posted');assert.notEqual(f.mutations[0].key,f.mutations[1].key);assert.equal(f.keys.size,1);
  const g=setup(t);await g.proof();g.timeout();await g.service.reconcile(g.report);g.advance();
  assert.equal((await g.service.reconcile(g.report)).results[0].status,'requires_review');assert.equal(g.mutations.length,1);
});
test('changed counts and duplicate reports cannot replay previous adjustment',async t=>{
  const f=setup(t);await f.proof();await f.service.reconcile(f.report);
  f.report.items[0].actuallyReceived=1;f.report.items[0].orderDiff=-6;
  assert.equal((await f.service.reconcile(f.report)).results[0].status,'requires_review');
  f.report.id+='duplicate';assert.equal((await f.service.reconcile(f.report)).results[0].status,'requires_review');assert.equal(f.mutations.length,1);
});
test('unfulfilled, wrong destination, wrong warehouse and pre-cutover are blocked',async t=>{
  for(const change of [f=>f.order.displayFulfillmentStatus='UNFULFILLED',f=>f.order.customer.tags=['Hummus Fit Bellmore'],
    f=>f.order.fulfillments[0].location.id=gid('Location',99),f=>f.report.submittedAt='2026-10-12T10:00:00Z',f=>f.report.store='Brookfield']) {
    const f=setup(t);change(f);await assert.rejects(f.service.reconcile(f.report));assert.equal(f.mutations.length,0);
  }
});
test('large overage, ambiguous SKU, essentials classification and invalid quantity fail closed',async t=>{
  for(const change of [f=>{f.report.items[0].actuallyReceived=19;f.report.items[0].orderDiff=12;},
    f=>f.order.lineItems.nodes.push(f.order.lineItems.nodes[0]),f=>f.product.tags=['retail-essentials'],
    f=>f.report.items[0].actuallyReceived=-1]) {
    const f=setup(t);await f.proof();change(f);assert.equal((await f.service.reconcile(f.report)).results[0].status,'requires_review');assert.equal(f.mutations.length,0);
  }
});
test('duplicate original Flow credit is retained as an exception, not overwritten',async t=>{
  const f=setup(t);await f.proof();f.credit.id=gid('InventoryAdjustmentGroup',6);f.groups.set(f.credit.id,f.credit);
  await assert.rejects(f.proof(),/Multiple/);assert.equal((await f.service.reconcile(f.report)).results[0].status,'requires_review');assert.equal(f.mutations.length,0);
});
test('damaged persisted ledger fails closed',async t=>{
  const f=setup(t);await f.proof();fs.writeFileSync(path.join(f.dir,'automatic-receiving-v1.json'),'broken');
  assert.equal((await f.service.reconcile(f.report)).results[0].status,'retry');assert.equal(f.mutations.length,0);
});
test('combined receipt resolves unique source order and restart does not duplicate',async t=>{
  const f=setup(t,'Lake Grove');await f.proof();
  const second={...f.order,id:gid('Order',9),name:'#9',lineItems:{pageInfo:{hasNextPage:false},nodes:[]}};
  f.deps.orderQuery=async(q,v)=>({order:v.id===f.order.id?f.order:second});
  f.report.orderId+=','+second.id;f.report.orderName+=', '+second.name;
  let service=createAutomaticReceiving(f.deps);
  const r=await service.reconcile(f.report);
  assert.equal(r.results[0].orderId,f.order.id);assert.equal(r.results[0].status,'posted');
  service=createAutomaticReceiving(f.deps);await service.reconcile(f.report);
  assert.equal(f.mutations.length,1);
  const ledger=Object.values(JSON.parse(fs.readFileSync(path.join(f.dir,'automatic-receiving-v1.json'))));
  assert.equal(ledger[0].orderId,f.order.id);
  const standalone={...f.report,id:'Lake Grove::duplicate',orderId:f.order.id,orderName:f.order.name};
  assert.equal((await service.reconcile(standalone)).results[0].status,'requires_review');
  assert.equal(f.mutations.length,1);
});
test('combined shared SKU and off-order extras are held without inventory writes',async t=>{
  const f=setup(t);await f.proof();const second={...f.order,id:gid('Order',9),name:'#9'};
  f.deps.orderQuery=async(q,v)=>({order:v.id===f.order.id?f.order:second});
  f.report.orderId+=','+second.id;f.report.orderName+=', '+second.name;
  f.report.extraItems=[{sku:'BOWL',qty:2,source:'scan'}];
  const r=await createAutomaticReceiving(f.deps).reconcile(f.report);
  assert.deepEqual(r.results.map(x=>x.status),['requires_review','requires_review']);assert.equal(f.mutations.length,0);
});
test('all combined orders must pass warehouse and destination checks before writing',async t=>{
  const f=setup(t);await f.proof();const second={...f.order,id:gid('Order',9),name:'#9',customer:{tags:['Hummus Fit Bellmore']}};
  f.deps.orderQuery=async(q,v)=>({order:v.id===f.order.id?f.order:second});
  f.report.orderId+=','+second.id;f.report.orderName+=', '+second.name;
  await assert.rejects(createAutomaticReceiving(f.deps).reconcile(f.report),/destination/);assert.equal(f.mutations.length,0);
});
test('malformed and repeated combined IDs stop before Shopify requests',async t=>{
  for(const id of ['bad','gid://shopify/Order/1,gid://shopify/Order/1']) {
    const f=setup(t);let calls=0;f.deps.orderQuery=async()=>{calls++;};f.report.orderId=id;
    await assert.rejects(createAutomaticReceiving(f.deps).reconcile(f.report),/unique receipt/);assert.equal(calls,0);
  }
});
