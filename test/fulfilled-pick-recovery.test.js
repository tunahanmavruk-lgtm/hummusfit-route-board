const test=require('node:test'),assert=require('node:assert/strict');
const {recoverFulfilledPick}=require('../fulfilled-pick-recovery');
const now=new Date('2026-10-27T14:20:00Z');
function fixture(){return {order:{id:'gid://shopify/Order/123',name:'#123',createdAt:'2026-10-26T20:00:00Z',displayFulfillmentStatus:'FULFILLED',customer:{tags:['Hummus Fit Holbrook']},lineItems:{pageInfo:{hasNextPage:false},nodes:[{id:'gid://shopify/LineItem/1',title:'Food',sku:'FOOD',quantity:2,variant:{id:'gid://shopify/ProductVariant/1',product:{tags:[],collections:{pageInfo:{hasNextPage:false},nodes:[]}}}}]},fulfillments:[{id:'f1',createdAt:'2026-10-27T14:10:00Z',status:'SUCCESS',location:{id:'gid://shopify/Location/103133642999'},fulfillmentLineItems:{pageInfo:{hasNextPage:false},nodes:[{quantity:2,lineItem:{id:'gid://shopify/LineItem/1'}}]}}]},record:{orderId:'gid://shopify/Order/123',pickedBy:'Picker',completedAt:null,itemStatus:{'Food::FOOD':'picked'},itemScannedCount:{'Food::FOOD':2},closedCrates:[1]}};}
test('completed shipping and exact saved scans recover receiving without mutating picking or inventory',()=>{
 const {order,record}=fixture(),before=JSON.stringify(record),result=recoverFulfilledPick(order,record,'Holbrook',now);
 assert.equal(result.source.orderId,order.id);assert.equal(result.source.lineItems[0].quantity,2);assert.equal(result.record.completedAt,'2026-10-27T14:10:00Z');assert.equal(JSON.stringify(record),before);
});
test('recovery fails closed for incomplete, mismatched, cross-store, unscanned, or unshipped evidence',()=>{
 for(const change of [f=>f.order.id+='9',f=>f.order.customer.tags=['Hummus Fit Islip'],f=>f.order.displayFulfillmentStatus='UNFULFILLED',f=>f.order.lineItems.pageInfo.hasNextPage=true,f=>f.order.fulfillments[0].location.id='other',f=>f.order.fulfillments[0].status='CANCELLED',f=>f.order.fulfillments[0].fulfillmentLineItems.nodes[0].quantity=1,f=>f.order.fulfillments[0].fulfillmentLineItems.pageInfo.hasNextPage=true,f=>f.record.itemScannedCount['Food::FOOD']=1,f=>f.record.itemStatus['Food::FOOD']='not_picked',f=>f.order.createdAt='2026-10-25T20:00:00Z',f=>f.record.itemStatus['Unrelated::ITEM']='picked']){
  const f=fixture();change(f);assert.throws(()=>recoverFulfilledPick(f.order,f.record,'Holbrook',now));
 }
});

const {recoverFulfilledDelivery,automaticFulfilledDelivery,recoveryOrderIds}=require('../fulfilled-pick-recovery');
function mixedFixture(){
 const f=fixture();const key='Drink case::CASE-X';
 f.order.lineItems.nodes.push({id:'gid://shopify/LineItem/2',title:'Drink case',sku:'CASE-X',quantity:1,variant:{id:'gid://shopify/ProductVariant/2',product:{tags:['Retail Essentials'],collections:{nodes:[],pageInfo:{hasNextPage:false}}}}});
 f.order.fulfillments[0].fulfillmentLineItems.nodes.push({quantity:1,lineItem:{id:'gid://shopify/LineItem/2'}});
 return {...f,records:{picking:f.record,essentials:{orderId:f.order.id,pickedBy:'Essentials picker',completedAt:null,itemStatus:{[key]:'picked'},itemScannedCount:{[key]:1},closedCrates:[1]}}};
}
test('food and Essentials recover automatically with both Finish timestamps missing',()=>{
 const f=mixedFixture(),before=JSON.stringify(f.records),r=recoverFulfilledDelivery([f.order],f.records,'Holbrook',now,true);
 assert.equal(r.source.lineItems.length,2);assert.equal(r.essentialsRecord.itemScannedCount['Drink case::CASE-X'],1);
 assert.equal(r.record.completedAt,'2026-10-27T14:10:00Z');assert.equal(r.essentialsRecord.completedAt,r.record.completedAt);assert.equal(JSON.stringify(f.records),before);
 for(const change of [x=>x.records.essentials.orderId+='9',x=>x.records.essentials.itemScannedCount['Drink case::CASE-X']=0,x=>x.records.essentials.itemStatus['Drink case::CASE-X']='not_picked']){
  const changed=mixedFixture();change(changed);assert.throws(()=>recoverFulfilledDelivery([changed.order],changed.records,'Holbrook',now,true));
 }
});
test('Essentials-only order can recover without any matching food record',()=>{
 const f=mixedFixture();f.order.lineItems.nodes.shift();f.order.fulfillments[0].fulfillmentLineItems.nodes.shift();f.records.picking.orderId+='9';
 const r=recoverFulfilledDelivery([f.order],f.records,'Holbrook',now,true);assert.equal(r.source.lineItems.length,1);assert.equal(r.record.pickedBy,'Essentials picker');
});
test('combined orders verify every shipment and merge the exact variant count without changing saved picks',()=>{
 const f=fixture(),second=structuredClone(f.order);second.id='gid://shopify/Order/124';second.name='#124';second.lineItems.nodes[0].id='gid://shopify/LineItem/2';second.lineItems.nodes[0].quantity=3;second.fulfillments[0].fulfillmentLineItems.nodes=[{quantity:3,lineItem:{id:'gid://shopify/LineItem/2'}}];
 f.record.orderId=second.id+','+f.order.id;f.record.itemScannedCount['Food::FOOD']=5;
 const r=recoverFulfilledDelivery([second,f.order],{picking:f.record},'Holbrook',now,true);
 assert.equal(r.source.orderId,f.order.id+','+second.id);assert.equal(r.source.orderName,'#123, #124');assert.equal(r.source.lineItems[0].quantity,5);assert.equal(r.source.lineItems.length,1);
 const duplicateSku=structuredClone(second);duplicateSku.lineItems.nodes[0].variant.id='gid://shopify/ProductVariant/99';
 assert.throws(()=>recoverFulfilledDelivery([f.order,duplicateSku],{picking:f.record},'Holbrook',now,true));
 second.displayFulfillmentStatus='PARTIALLY_FULFILLED';assert.throws(()=>recoverFulfilledDelivery([f.order,second],{picking:f.record},'Holbrook',now,true));
});
test('a mixed prior-morning add-on and current delivery recover only after every exact order ships today',()=>{
 const f=fixture(),second=structuredClone(f.order);
 f.order.createdAt='2026-10-26T14:00:00Z'; // Previous day, before the noon cutoff.
 second.id='gid://shopify/Order/124';second.name='#124';
 second.lineItems.nodes[0].id='gid://shopify/LineItem/2';
 second.fulfillments[0].fulfillmentLineItems.nodes[0].lineItem.id='gid://shopify/LineItem/2';
 f.record.orderId=f.order.id+','+second.id;f.record.itemScannedCount['Food::FOOD']=4;
 const recovered=recoverFulfilledDelivery([f.order,second],{picking:f.record},'Holbrook',now,true);
 assert.equal(recovered.deliveryDate,'2026-10-27');
 assert.equal(recovered.source.lineItems[0].quantity,4);
 assert.equal(recovered.shipmentVerifiedAt,'2026-10-27T14:10:00Z');
 const oldShipment=structuredClone(second);oldShipment.fulfillments[0].createdAt='2026-10-26T20:10:00Z';
 assert.throws(()=>recoverFulfilledDelivery([f.order,oldShipment],{picking:f.record},'Holbrook',now,true));
 const olderOrder=structuredClone(f.order);olderOrder.createdAt='2026-10-25T14:00:00Z';
 assert.throws(()=>recoverFulfilledDelivery([olderOrder,second],{picking:f.record},'Holbrook',now,true));
 const unfulfilled=structuredClone(second);unfulfilled.displayFulfillmentStatus='UNFULFILLED';
 assert.throws(()=>recoverFulfilledDelivery([f.order,unfulfilled],{picking:f.record},'Holbrook',now,true));
});
test('SKU-less fulfilled lines use exact variant and saved title counts without weakening case conversion',()=>{
 const f=fixture(),second=structuredClone(f.order);
 f.order.createdAt='2026-10-26T14:00:00Z';
 f.order.lineItems.nodes[0].sku=null;
 second.id='gid://shopify/Order/124';second.name='#124';
 second.lineItems.nodes[0].id='gid://shopify/LineItem/2';second.lineItems.nodes[0].sku=null;
 second.fulfillments[0].fulfillmentLineItems.nodes[0].lineItem.id='gid://shopify/LineItem/2';
 f.record.orderId=f.order.id+','+second.id;
 f.record.itemStatus={'Food::':'picked'};f.record.itemScannedCount={'Food::':4};
 const r=recoverFulfilledDelivery([f.order,second],{picking:f.record},'Holbrook',now,true);
 assert.equal(r.source.lineItems[0].sku,'');assert.equal(r.source.lineItems[0].quantity,4);
 assert.deepEqual(r.source.lineItems[0].scanCodes,[]);
 const changedVariant=structuredClone(second);changedVariant.lineItems.nodes[0].variant.id='gid://shopify/ProductVariant/99';
 assert.throws(()=>recoverFulfilledDelivery([f.order,changedVariant],{picking:f.record},'Holbrook',now,true));
 const changedCount=structuredClone(f.record);changedCount.itemScannedCount['Food::']=3;
 assert.throws(()=>recoverFulfilledDelivery([f.order,second],{picking:changedCount},'Holbrook',now,true));
});
test('regular receiving requests detect a later Shopify fulfillment without a manual repair or Finish',async()=>{
 const f=mixedFixture(),before=JSON.stringify(f.records),calls=[];let fulfilled=false;
 const query=async(document,variables,version)=>{assert.match(document,/^query /);assert.equal(version,'2026-07');calls.push(variables.id);return {order:{...f.order,displayFulfillmentStatus:fulfilled?'FULFILLED':'UNFULFILLED'}};};
 const args={selected:null,records:f.records,store:'Holbrook',query,now,separationEnabled:true};
 assert.equal(await automaticFulfilledDelivery(args),null);fulfilled=true;
 const r=await automaticFulfilledDelivery(args);assert.equal(r.source.orderId,f.order.id);assert.equal(r.source.lineItems.length,2);assert.equal(JSON.stringify(f.records),before);assert.deepEqual(calls,[f.order.id,f.order.id]);
});
test('saved current snapshot is reused without Shopify reads and a failed lookup cannot replace it',async()=>{
 const f=fixture(),selected={source:{orderId:f.order.id},record:{completedAt:'2026-10-27T14:15:00Z'}};let calls=0;
 const args={selected,records:{picking:f.record},store:'Holbrook',now,query:async()=>{calls++;throw Error('offline');}};
 assert.equal(await automaticFulfilledDelivery(args),selected);assert.equal(calls,0);
 args.records.picking={...f.record,orderId:'gid://shopify/Order/999'};assert.equal(await automaticFulfilledDelivery(args),selected);assert.equal(calls,1);
});
test('only exact, duplicate-free order ID sets can trigger automatic lookup',()=>{
 for(const value of ['',null,'#123','gid://shopify/Order/1,gid://shopify/Order/1','gid://shopify/Product/123'])assert.equal(recoveryOrderIds(value),null);
 assert.deepEqual(recoveryOrderIds('gid://shopify/Order/2,gid://shopify/Order/1'),['gid://shopify/Order/1','gid://shopify/Order/2']);
});

test('receiving HTTP handler changes from waiting to a complete food/Essentials form after Shopify fulfillment',async()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
 const file=path.join(__dirname,'../server.js'),source=fs.readFileSync(file,'utf8');
 const start=source.indexOf('app.get("/api/picked-summary/:stopName"'),end=source.indexOf('// Only the separate Hummus Fit Receiving service',start);
 const f=mixedFixture(),state={picking:{holbrook:f.records.picking},essentialsPicking:{holbrook:f.records.essentials}},before=JSON.stringify(state);
 const current={orderId:f.order.id,orderName:f.order.name,createdAt:f.order.createdAt,lineItems:[{title:'Food',sku:'FOOD',quantity:2,productTags:[]},{title:'Drink case',sku:'CASE-X',quantity:1,productTags:['Retail Essentials']}]};
 let handler,fulfilled=false,reads=0;const localRequire=createRequire(file),realRecovery=localRequire('./fulfilled-pick-recovery'),selection=localRequire('./receiving-selection');
 const context={app:{get:(url,callback)=>{handler=callback;}},require:name=>name==='./receiving-selection'?{...selection,selectReceivingDelivery:args=>selection.selectReceivingDelivery({...args,now})}:name==='./fulfilled-pick-recovery'?{...realRecovery,automaticFulfilledDelivery:args=>realRecovery.automaticFulfilledDelivery({...args,now})}:localRequire(name),
  console:{log(){}},pickingKeyFor:name=>name.toLowerCase(),fetchTodaysStopOrders:async()=>({byStopName:{holbrook:current}}),loadState:()=>state,loadArchive:()=>({}),
  POS_STORE_LOCATIONS:localRequire('./essentials-pos-conversion').POS_STORE_LOCATIONS,ESSENTIALS_SEPARATION_ENABLED:true,
  essentialsTypeFor:localRequire('./essentials-shadow').essentialsTypeFor,caseMapping:localRequire('./essentials-pos-conversion').caseMapping,
  readItemState:(dict,item)=>dict?.[item.title+'::'+item.sku],crateHasAnyItems:()=>false,
  shopifyGraphQL:async(document)=>{assert.match(document,/^query /);reads++;return {order:{...f.order,displayFulfillmentStatus:fulfilled?'FULFILLED':'UNFULFILLED'}};}};
 vm.runInNewContext(source.slice(start,end),context);
 const response=()=>({statusCode:200,set(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}});
 let res=response();await handler({params:{stopName:'Holbrook'}},res);assert.equal(res.statusCode,409);
 fulfilled=true;
 for(let i=0;i<3;i++){
  res=response();await handler({params:{stopName:'Holbrook'}},res);assert.equal(res.statusCode,200);assert.equal(res.body.deliveryDate,'2026-10-27');
  assert.equal(res.body.items.find(i=>i.sku==='FOOD').pickedQty,2);assert.equal(res.body.items.find(i=>i.sku==='CASE-X').pickedQty,1);
 }
 assert.equal(reads,4);assert.equal(JSON.stringify(state),before);assert.equal(f.records.picking.completedAt,null);assert.equal(f.records.essentials.completedAt,null);
});
