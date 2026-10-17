const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {ORDER_QUERY,CREATE_MUTATION,backorderDecision,validBackorder,createCompletionFulfillment,canonicalStore}=require('../completion-fulfillment');
const orderId='gid://shopify/Order/1', food='gid://shopify/LineItem/1', ghost='gid://shopify/LineItem/2';
const warehouse='gid://shopify/Location/103133642999';
function fixture(store='Huntington'){
  return {id:orderId,name:'#1',cancelledAt:null,tags:[],customer:{tags:[`Hummus Fit ${store}`]},displayFulfillmentStatus:'UNFULFILLED',
    lineItems:{nodes:[{id:food,title:'Food',sku:'FOOD',quantity:12,currentQuantity:12},{id:ghost,title:'GHOST',sku:'GHOST',quantity:1,currentQuantity:1}],pageInfo:{hasNextPage:false}},
    fulfillments:[],fulfillmentOrders:{nodes:[{id:'gid://shopify/FulfillmentOrder/1',status:'OPEN',assignedLocation:{location:{id:warehouse}},lineItems:{nodes:[{id:'gid://shopify/FulfillmentOrderLineItem/1',lineItem:{id:food},remainingQuantity:12},{id:'gid://shopify/FulfillmentOrderLineItem/2',lineItem:{id:ghost},remainingQuantity:1}],pageInfo:{hasNextPage:false}}}],pageInfo:{hasNextPage:false}}};
}
function setup(t,{store='Huntington',ghostQuantity=0,mode,order:given}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'completion-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  let order=given||fixture(store),calls=0;
  const query=async(q,vars)=>{
    if(q===ORDER_QUERY)return {order:structuredClone(order)};
    assert.equal(q,CREATE_MUTATION);calls++;
    // Verify the durable intent exists before the external side effect.
    assert.ok(Object.values(JSON.parse(fs.readFileSync(path.join(dir,'completion-fulfillments-v1.json'))))[0].orders[orderId].attemptedAt);
    assert.equal(vars.fulfillment.notifyCustomer,false);
    const sent=vars.fulfillment.lineItemsByFulfillmentOrder.flatMap(f=>f.fulfillmentOrderLineItems);
    assert.ok(sent.length);assert.ok(sent.every(l=>Number.isSafeInteger(l.quantity)&&l.quantity>0));
    if(mode==='error')return {fulfillmentCreate:{userErrors:[{message:'Unavailable'}]}};
    if(mode==='lost-before-write')throw Error('Network timeout');
    const f={id:'gid://shopify/Fulfillment/1',status:'SUCCESS',location:{id:warehouse},fulfillmentLineItems:{nodes:sent.map(s=>({quantity:s.quantity,lineItem:{id:s.id.endsWith('/1')?food:ghost}})),pageInfo:{hasNextPage:false}}};
    order.fulfillments.push(f);order.displayFulfillmentStatus=ghostQuantity?'FULFILLED':'PARTIALLY_FULFILLED';
    if(mode==='lost-after-write')throw Error('Response lost');
    return {fulfillmentCreate:{fulfillment:{id:f.id,status:'SUCCESS'},userErrors:[]}};
  };
  const source={orderId,orders:[{id:orderId}],lineItems:[{title:'Food',sku:'FOOD',quantity:12},{title:'GHOST',sku:'GHOST',quantity:1}]};
  const request={store,source,caseLines:[{key:'GHOST::GHOST',ordered:1,shipped:ghostQuantity}],confirmedBy:'Staff'};
  const make=()=>createCompletionFulfillment({dir,query});
  const service=make(),key=service.enqueue(request);
  return {service,key,make,order,source,request,query,dir,calls:()=>calls};
}
test('backorder requires explicit exact order, count and staff evidence',()=>{
  const item={title:'GHOST',sku:'GHOST',quantity:2};
  const proof=backorderDecision(orderId,item,1,'Staff'),record={caseBackorders:{'GHOST::GHOST':proof}};
  assert.equal(validBackorder(record,orderId,item,1),true);
  assert.equal(validBackorder(record,'other',item,1),false);
  assert.equal(validBackorder(record,orderId,item,0),false);
  assert.equal(validBackorder(record,orderId,{...item,quantity:3},1),false);
  assert.throws(()=>backorderDecision(orderId,item,3,'Staff'));
  assert.throws(()=>backorderDecision(orderId,item,0,''));
  assert.equal(validBackorder({},orderId,item,0),false);
});
test('Huntington fulfills food once, leaves GHOST untouched; retry/restart/double tap cannot duplicate',async t=>{
  const s=setup(t);
  const results=await Promise.all([s.service.run(s.key),s.service.run(s.key)]);
  assert.ok(results.every(r=>r.status==='fulfilled_with_backorder'));
  assert.equal(s.calls(),1);
  assert.deepEqual(s.order.fulfillments[0].fulfillmentLineItems.nodes,[{quantity:12,lineItem:{id:food}}]);
  assert.equal((await s.make().run(s.key)).status,'fulfilled_with_backorder');assert.equal(s.calls(),1);
});
test('response lost after Shopify accepts: restart verifies existing fulfillment, never resends',async t=>{
  const s=setup(t,{mode:'lost-after-write'});
  assert.equal((await s.service.run(s.key)).status,'needs_review');
  assert.equal((await s.make().run(s.key)).status,'fulfilled_with_backorder');assert.equal(s.calls(),1);
});
test('response lost with no proof: retries only check, never issue a second request',async t=>{
  const s=setup(t,{mode:'lost-before-write'});
  await s.service.run(s.key); const result=await s.make().run(s.key);
  assert.equal(result.status,'needs_review');assert.match(result.error,/uncertain/);assert.equal(s.calls(),1);
});
test('Shopify rejection does not become a blind retry',async t=>{
  const s=setup(t,{mode:'error'});await s.service.run(s.key);await s.service.run(s.key);assert.equal(s.calls(),1);
});
test('all 13 legacy stores hold partial fulfillment before any side effect',async t=>{
  const {POS_STORE_LOCATIONS}=require('../essentials-pos-conversion');
  for(const store of Object.keys(POS_STORE_LOCATIONS).filter(s=>s!=='Huntington')){
    const order=fixture(store);order.customer.tags=[POS_STORE_LOCATIONS[store]];
    const s=setup(t,{store,order});const result=await s.service.run(s.key);
    assert.equal(result.status,'needs_review');assert.match(result.error,/legacy inventory-credit/);assert.equal(s.calls(),0);
  }
});
test('complete shipments work once without altering food calculations',async t=>{
  const s=setup(t,{store:'Bellmore',ghostQuantity:1});
  assert.equal((await s.service.run(s.key)).status,'fulfilled');await s.service.run(s.key);assert.equal(s.calls(),1);
  assert.equal(s.order.fulfillments[0].fulfillmentLineItems.nodes.find(l=>l.lineItem.id===food).quantity,12);
});
test('changed counts or overlapping order set cannot create another shipment',t=>{
  const s=setup(t);
  assert.equal(s.service.enqueue(s.request),s.key);
  assert.throws(()=>s.service.enqueue({...s.request,caseLines:[{key:'GHOST::GHOST',ordered:1,shipped:1}]}),/different counts/);
  assert.throws(()=>s.service.enqueue({...s.request,source:{...s.source,orders:[{id:orderId},{id:'gid://shopify/Order/2'}]}}),/overlapping/);
});
test('wrong location, destination, changed quantities, pagination fail closed',async t=>{
  const cases=[o=>o.customer.tags=['Hummus Fit Holbrook'],o=>o.fulfillmentOrders.nodes[0].assignedLocation.location.id='wrong',
    o=>o.lineItems.pageInfo.hasNextPage=true,o=>o.fulfillmentOrders.pageInfo.hasNextPage=true,
    o=>o.lineItems.nodes[0].currentQuantity=11,o=>o.lineItems.nodes[0].quantity=13,
    o=>o.fulfillmentOrders.nodes[0].lineItems.pageInfo.hasNextPage=true];
  for(const change of cases){const order=fixture();change(order);const s=setup(t,{order});assert.equal((await s.service.run(s.key)).status,'needs_review');assert.equal(s.calls(),0);}
});
test('scope excludes B2B and maps East Islip exactly',t=>{
  const s=setup(t);assert.equal(canonicalStore('Hummus Fit East Islip'),'Islip');assert.equal(canonicalStore('B2B'),undefined);
  assert.throws(()=>s.service.enqueue({...s.request,source:{...s.source,isB2B:true}}));
  assert.throws(()=>createCompletionFulfillment({dir:s.dir,query:s.query,durable:false}).enqueue(s.request),/Persistent/);
});
test('completed backorder subsequently shipped is proof, not another credit or shipment',async t=>{
  const s=setup(t);await s.service.run(s.key);
  s.order.fulfillments.push({id:'gid://shopify/Fulfillment/2',status:'SUCCESS',location:{id:warehouse},fulfillmentLineItems:{nodes:[{quantity:1,lineItem:{id:ghost}}],pageInfo:{hasNextPage:false}}});
  await s.service.run(s.key);assert.equal(s.calls(),1);
});
