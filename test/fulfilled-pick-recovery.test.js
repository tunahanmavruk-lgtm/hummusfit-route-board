const test=require('node:test'),assert=require('node:assert/strict');
const {recoverFulfilledPick}=require('../fulfilled-pick-recovery');
const now=new Date('2026-10-27T14:20:00Z');
function fixture(){return {order:{id:'gid://shopify/Order/123',name:'#123',createdAt:'2026-10-26T20:00:00Z',displayFulfillmentStatus:'FULFILLED',customer:{tags:['Hummus Fit Holbrook']},lineItems:{pageInfo:{hasNextPage:false},nodes:[{id:'gid://shopify/LineItem/1',title:'Food',sku:'FOOD',quantity:2,variant:{product:{tags:[],collections:{pageInfo:{hasNextPage:false},nodes:[]}}}}]},fulfillments:[{id:'f1',createdAt:'2026-10-27T14:10:00Z',status:'SUCCESS',location:{id:'gid://shopify/Location/103133642999'},fulfillmentLineItems:{pageInfo:{hasNextPage:false},nodes:[{quantity:2,lineItem:{id:'gid://shopify/LineItem/1'}}]}}]},record:{orderId:'gid://shopify/Order/123',pickedBy:'Picker',completedAt:null,itemStatus:{'Food::FOOD':'picked'},itemScannedCount:{'Food::FOOD':2},closedCrates:[1]}};}
test('completed shipping and exact saved scans recover receiving without mutating picking or inventory',()=>{
 const {order,record}=fixture(),before=JSON.stringify(record),result=recoverFulfilledPick(order,record,'Holbrook',now);
 assert.equal(result.source.orderId,order.id);assert.equal(result.source.lineItems[0].quantity,2);assert.equal(result.record.completedAt,'2026-10-27T14:10:00Z');assert.equal(JSON.stringify(record),before);
});
test('recovery fails closed for incomplete, mismatched, cross-store, unscanned, or unshipped evidence',()=>{
 for(const change of [f=>f.order.id+='9',f=>f.order.customer.tags=['Hummus Fit Islip'],f=>f.order.displayFulfillmentStatus='UNFULFILLED',f=>f.order.lineItems.pageInfo.hasNextPage=true,f=>f.order.fulfillments[0].location.id='other',f=>f.order.fulfillments[0].status='CANCELLED',f=>f.order.fulfillments[0].fulfillmentLineItems.nodes[0].quantity=1,f=>f.order.fulfillments[0].fulfillmentLineItems.pageInfo.hasNextPage=true,f=>f.record.itemScannedCount['Food::FOOD']=1,f=>f.record.itemStatus['Food::FOOD']='not_picked',f=>f.order.createdAt='2026-10-25T20:00:00Z',f=>f.record.itemStatus['Unrelated::ITEM']='picked']){
  const f=fixture();change(f);assert.throws(()=>recoverFulfilledPick(f.order,f.record,'Holbrook',now));
 }
});
