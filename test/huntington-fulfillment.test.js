const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createFulfillmentCredit,ACTIVATE_CASE_MUTATION}=require('../huntington-fulfillment-credit');
const {deliveredQuantities,partialReceiptAllowed,fullyDelivered,WAREHOUSE,LOCATION}=require('../huntington-fulfillment');
const {ORDER_QUERY,GROUP_QUERY,ADJUST_MUTATION,checkOrder,RELEASE}=require('../automatic-receiving');
const gid=(t,n)=>`gid://shopify/${t}/${n}`;
function fixture(t, store='Huntington') {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'huntington-credit-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const lines=[{id:gid('LineItem',1),sku:'food',quantity:2,variant:{id:gid('ProductVariant',1),inventoryItem:{id:gid('InventoryItem',1)}}},
    {id:gid('LineItem',2),sku:'ghost',quantity:1,variant:{id:gid('ProductVariant',2),inventoryItem:{id:gid('InventoryItem',2)}}}];
  const order={id:gid('Order',1),name:'#1',createdAt:'2026-10-16T10:00:00Z',displayFulfillmentStatus:'PARTIALLY_FULFILLED',customer:{tags:['Hummus Fit Huntington']},lineItems:{nodes:lines,pageInfo:{hasNextPage:false}},
    fulfillments:[{id:gid('Fulfillment',1),createdAt:'2026-10-16T22:00:00Z',status:'SUCCESS',location:{id:WAREHOUSE},fulfillmentLineItems:{nodes:[{quantity:2,lineItem:{id:lines[0].id}}],pageInfo:{hasNextPage:false}}}]};
  order.customer.tags=['Hummus Fit '+store];
  if(store!=='Huntington') order.fulfillments[0].createdAt='2026-10-18T22:00:00Z';
  let writes=0,lose=false,inactive=false,activatedLevel=false,activations=0,clock=Date.parse(store==='Huntington'?'2026-10-16T22:01:00Z':'2026-10-18T22:01:00Z');const groups=new Map(),keys=new Map();
  const query=async(q,v)=>{
    if(q===ACTIVATE_CASE_MUTATION){activations++;inactive=false;activatedLevel=true;return {inventoryActivate:{inventoryLevel:{id:gid('InventoryLevel',1)},userErrors:[]}};}
    if(q===GROUP_QUERY)return {node:groups.get(v.id)};
    if(q===ADJUST_MUTATION){
      if(!keys.has(v.key)) {const id=gid('InventoryAdjustmentGroup',++writes);keys.set(v.key,id);groups.set(id,{id,createdAt:new Date(clock).toISOString(),referenceDocumentUri:v.input.referenceDocumentUri,changes:v.input.changes.map(c=>({name:'available',delta:c.delta,item:{id:c.inventoryItemId},location:{id:c.locationId}}))});}
      if(lose){lose=false;throw new Error('network lost');}
      return {inventoryAdjustQuantities:{inventoryAdjustmentGroup:{id:keys.get(v.key)},userErrors:[]}};
    }
    return {inventoryItem:{id:v.id,sku:lines.find(l=>l.variant.inventoryItem.id===v.id).sku,tracked:true,inventoryLevel:inactive?null:{quantities:[{name:'available',quantity:activatedLevel?0:10}]}}};
  };
  const make=()=>createFulfillmentCredit({dir,orderQuery:async()=>({order}),inventoryQuery:query,orderQueryText:ORDER_QUERY,groupQuery:GROUP_QUERY,adjustMutation:ADJUST_MUTATION,now:()=>clock});
  const body={store,orderId:order.id,fulfillmentId:order.fulfillments[0].id,lineItemId:lines[0].id};
  return {dir,order,lines,body,make,groups,writes:()=>writes,activations:()=>activations,setInactive:()=>inactive=true,lose:()=>lose=true,advance:()=>clock+=7200000};
}
test('a mapped case activates a missing destination level before one credit',async t=>{
  const f=fixture(t,'Lake Grove');
  f.lines[0].sku='MF-7171015-CS';
  f.lines[0].variant.id='gid://shopify/ProductVariant/51259630125303';
  f.setInactive();
  await f.make().credit(f.body);
  await f.make().credit(f.body);
  assert.equal(f.activations(),1);
  assert.equal(f.writes(),1);
  const g=fixture(t,'Lake Grove');g.setInactive();
  await assert.rejects(g.make().credit(g.body),/activation needs review/);
  assert.equal(g.activations(),0);assert.equal(g.writes(),0);
});
test('a new Retail Essentials case can receive its exact case credit before unit mapping',async t=>{
  const f=fixture(t,'Bellmore');
  f.lines[0].sku='HF-NYB-RAW-602-C12';
  f.lines[0].variant.product={status:'ACTIVE',productType:'Retail Essentials - Case',tags:['retail-essentials','mapping-pending']};
  f.setInactive();
  await f.make().credit(f.body);
  await f.make().credit(f.body);
  assert.equal(f.activations(),1);
  assert.equal(f.writes(),1);
  for(const change of [
    product=>product.status='DRAFT',
    product=>product.productType='Other Essentials',
    product=>product.tags=['mapping-pending'],
  ]) {
    const blocked=fixture(t,'Bellmore');
    blocked.lines[0].sku='HF-NYB-RAW-602-C12';
    blocked.lines[0].variant.product={status:'ACTIVE',productType:'Retail Essentials - Case',tags:['retail-essentials','mapping-pending']};
    change(blocked.lines[0].variant.product);
    blocked.setInactive();
    await assert.rejects(blocked.make().credit(blocked.body),/activation needs review/);
    assert.equal(blocked.activations(),0);
    assert.equal(blocked.writes(),0);
  }
  const changed=fixture(t,'Bellmore');
  changed.lines[0].sku='MF-7171015-CS';
  changed.lines[0].variant.product={status:'ACTIVE',productType:'Retail Essentials - Case',tags:['retail-essentials']};
  changed.setInactive();
  await changed.make().credit(changed.body);
  assert.equal(changed.activations(),1);
  assert.equal(changed.writes(),1);
});
test('delivered items reconcile while GHOST stays uncredited; duplicate and concurrent events write once',async t=>{
  const f=fixture(t),service=f.make();
  await Promise.all([service.credit(f.body),service.credit(f.body)]);
  await f.make().credit(f.body);assert.equal(f.writes(),1);
  assert.equal((await service.credit({...f.body,lineItemId:f.lines[1].id})).status,'not_in_fulfillment');assert.equal(f.writes(),1);
  await service.verifyLine(f.order,f.lines[0]);await assert.rejects(service.verifyLine(f.order,f.lines[1]));
  const report={store:'Huntington',orderId:f.order.id,orderName:f.order.name,submittedAt:'2026-10-16T17:04:00Z',automation:{version:RELEASE},items:[{sku:'food',orderedQty:2,actuallyReceived:4,expectedFromPicking:2},{sku:'ghost',orderedQty:1,actuallyReceived:0,expectedFromPicking:0}]};
  assert.equal(partialReceiptAllowed(report,f.order),true);checkOrder(report,f.order);assert.equal(fullyDelivered(f.order,'ghost'),false);
});
test('later GHOST fulfillment credits only GHOST and never replays the first delivery',async t=>{
  const f=fixture(t),s=f.make();await s.credit(f.body);
  f.order.fulfillments.push({...f.order.fulfillments[0],id:gid('Fulfillment',2),fulfillmentLineItems:{nodes:[{quantity:1,lineItem:{id:f.lines[1].id}}],pageInfo:{hasNextPage:false}}});
  f.order.displayFulfillmentStatus='FULFILLED';
  await s.credit({...f.body,fulfillmentId:gid('Fulfillment',2),lineItemId:f.lines[1].id});
  assert.equal((await s.credit({...f.body,fulfillmentId:gid('Fulfillment',2)})).status,'not_in_fulfillment');
  assert.equal(f.writes(),2);await s.verifyLine(f.order,f.lines[0]);
});
test('lost response and restart reuse exact idempotency key; old uncertainty blocks',async t=>{
  const f=fixture(t);f.lose();await assert.rejects(f.make().credit(f.body));await f.make().credit(f.body);assert.equal(f.writes(),1);
  const g=fixture(t);g.lose();await assert.rejects(g.make().credit(g.body));g.advance();await assert.rejects(g.make().credit(g.body),/Uncertain/);assert.equal(g.writes(),1);
});
test('legacy credits, wrong location, incomplete evidence and pre-cutover fulfillments fail closed',async t=>{
  for(const change of [f=>f.order.fulfillments[0].location.id=LOCATION,f=>f.order.fulfillments[0].fulfillmentLineItems.pageInfo.hasNextPage=true,
    f=>f.order.fulfillments[0].createdAt='2026-10-16T20:00:00Z',f=>f.order.customer.tags=['Hummus Fit Holbrook'],
    f=>f.order.fulfillments.push(f.order.fulfillments[0]),f=>f.order.fulfillments[0].fulfillmentLineItems.nodes[0].quantity=3]) {
    const f=fixture(t);change(f);await assert.rejects(f.make().credit(f.body));assert.equal(f.writes(),0);
  }
  const f=fixture(t);fs.writeFileSync(path.join(f.dir,'store-flow-credit-proofs.json'),JSON.stringify({x:{orderId:f.order.id,lineItemId:f.lines[0].id}}));
  await assert.rejects(f.make().credit(f.body),/legacy/);assert.equal(f.writes(),0);
});
test('wrong or missing Shopify credit proof cannot authorize corrections',async t=>{
  const f=fixture(t),s=f.make();await s.credit(f.body);f.groups.values().next().value.changes[0].delta=5;await assert.rejects(s.verifyLine(f.order,f.lines[0]),/proof/);
});
test('all 14 stores credit exact destination once and later backorders never replay delivered lines',async t=>{
  const {LOCATIONS}=require('../store-fulfillment-policy');
  for(const [store,location] of Object.entries(LOCATIONS)) {
    const f=fixture(t,store),s=f.make();
    await Promise.all([s.credit(f.body),s.credit(f.body)]);await f.make().credit(f.body);
    assert.equal(f.writes(),1,store);
    assert.equal(f.groups.values().next().value.changes[0].location.id,gid('Location',location));
    assert.equal((await s.credit({...f.body,lineItemId:f.lines[1].id})).status,'not_in_fulfillment');
    f.order.fulfillments.push({...f.order.fulfillments[0],id:gid('Fulfillment',2),fulfillmentLineItems:{nodes:[{quantity:1,lineItem:{id:f.lines[1].id}}],pageInfo:{hasNextPage:false}}});
    f.order.displayFulfillmentStatus='FULFILLED';
    const later={...f.body,fulfillmentId:gid('Fulfillment',2),lineItemId:f.lines[1].id};
    await s.credit(later);await f.make().credit(later);
    assert.equal((await s.credit({...later,lineItemId:f.lines[0].id})).status,'not_in_fulfillment');
    assert.equal(f.writes(),2,store);await s.verifyLine(f.order,f.lines[0]);await s.verifyLine(f.order,f.lines[1]);
  }
});
