const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {STORE,ORDER,SKUS,ID,validateRequest,selectedPlan,verifyConversion,createConfirmedLineReceiving}=require('../confirmed-line-receiving');
const {ORDER_QUERY,CREATE_MUTATION}=require('../completion-fulfillment');
const {ORDER_QUERY:PROOF_ORDER_QUERY,GROUP_QUERY}=require('../automatic-receiving');
const {receiptKey}=require('../essentials-pos-conversion');
const locationId='gid://shopify/Location/69550473463',warehouse='gid://shopify/Location/103133642999';
function setup(t,{failure,priorBalance=0}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'line-receiving-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let order={id:ORDER,name:'#769574',tags:[],customer:{tags:['Hummus Fit Lindenhurst']},displayFulfillmentStatus:'UNFULFILLED',cancelledAt:null,
   lineItems:{nodes:[...SKUS,'FOOD','OTHER-CASE'].map((sku,i)=>({id:'gid://shopify/LineItem/'+(i+1),title:sku,sku,quantity:1,currentQuantity:1,variant:{inventoryItem:{id:'case-'+sku}}})),pageInfo:{hasNextPage:false}},
   fulfillments:[],fulfillmentOrders:{nodes:[{id:'gid://shopify/FulfillmentOrder/1',status:'OPEN',assignedLocation:{location:{id:warehouse}},lineItems:{nodes:[...SKUS,'FOOD','OTHER-CASE'].map((sku,i)=>({id:'gid://shopify/FulfillmentOrderLineItem/'+(i+1),remainingQuantity:1,lineItem:{id:'gid://shopify/LineItem/'+(i+1)}})),pageInfo:{hasNextPage:false}}}],pageInfo:{hasNextPage:false}}};
 const balances={},canonical={},groups={},credits=new Map();let fulfilled=0,conversions=0,activations=0,failOnce=true;
 const req={store:STORE,orderId:ORDER,confirmedBy:'Tony',lines:SKUS.map(sku=>({sku,receivedCases:1})),historyReview:{orderId:ORDER,locationId,reviewedBy:'Tony-authorized Logistics',checkedAt:new Date().toISOString(),lines:SKUS.map(sku=>({sku,priorReceiptUnits:0,priorCaseCredits:0,salesUnits:0,noAdjustments180Days:true}))}};
 const exactItem=async(sku,_loc,sellable)=>({id:(sellable?'unit-':'case-')+sku,available:Object.hasOwn(balances,sku)?balances[sku]:null,price:3,unitCost:sellable?2:30});
 const orderQuery=async(q,v)=>{
   if([ORDER_QUERY,PROOF_ORDER_QUERY].includes(q))return {order:structuredClone(order)};
   assert.equal(q,CREATE_MUTATION);fulfilled++;
   const saved=JSON.parse(fs.readFileSync(path.join(dir,'confirmed-line-receipts-v1.json')))[ID];assert.ok(saved.fulfillmentAttemptedAt);
   const sent=v.fulfillment.lineItemsByFulfillmentOrder.flatMap(f=>f.fulfillmentOrderLineItems);
   assert.equal(sent.length,4);assert.ok(sent.every(x=>Number(x.id.split('/').at(-1))<=4));
   if(failure==='lost-before')throw Error('Lost response');
   order.fulfillments=[{id:'gid://shopify/Fulfillment/1',createdAt:new Date().toISOString(),status:'SUCCESS',location:{id:warehouse},fulfillmentLineItems:{nodes:sent.map(l=>({quantity:l.quantity,lineItem:{id:'gid://shopify/LineItem/'+l.id.split('/').at(-1)}})),pageInfo:{hasNextPage:false}}}];order.displayFulfillmentStatus='PARTIALLY_FULFILLED';
   if(failure==='lost-after')throw Error('Lost response');
   return {fulfillmentCreate:{fulfillment:{id:'gid://shopify/Fulfillment/1',status:'SUCCESS'},userErrors:[]}};
 };
 const deps={dir,durable:true,orderQuery,exactLocation:async()=>locationId,exactItem,
  activate:async(item)=>{activations++;balances[item.id.replace(/^(case|unit)-/,'')]=priorBalance;},
  loadCanonical:()=>canonical,hasPriorProof:()=>false,
  inventoryQuery:async(q,v)=>{assert.equal(q,GROUP_QUERY);return {node:groups[v.id]};},
  receivingService:{flowProof:async b=>{if(!credits.has(b.lineItemId)){credits.set(b.lineItemId,'credit-'+b.lineItemId);const sku=order.lineItems.nodes.find(l=>l.id===b.lineItemId).sku;balances[sku]++;}return {adjustmentId:credits.get(b.lineItemId)};},verifyFulfillmentCredit:async()=>true},
  convert:async(store,orderId,loc,m)=>{
   const key=receiptKey(store,orderId,m.caseSku);if(canonical[key])return {status:'already_posted'};
   if(failure==='conversion'&&failOnce){failOnce=false;throw Error('Conversion interrupted');}
   conversions++;const adjustmentId='gid://shopify/InventoryAdjustmentGroup/'+conversions;
   const input={referenceDocumentUri:'gid://hummusfit-receiving/CaseConversion/'+key,changes:[{inventoryItemId:'case-'+m.caseSku,locationId:loc,delta:-1},{inventoryItemId:'unit-'+m.unitSku,locationId:loc,delta:15}]};
   canonical[key]={status:'posted',units:15,adjustmentId,plan:{receivedCases:1,input}};
   groups[adjustmentId]={id:adjustmentId,referenceDocumentUri:input.referenceDocumentUri,changes:input.changes.map(c=>({name:'available',delta:c.delta,item:{id:c.inventoryItemId},location:{id:loc}}))};
   balances[m.caseSku]--;balances[m.unitSku]+=15;return {status:'posted'};
  }};
 return {deps,req,order,canonical,balances,counts:()=>({fulfilled,conversions,activations,credits:credits.size}),make:()=>createConfirmedLineReceiving(deps)};
}
test('exact four-line scope excludes other orders, counts, stores, missing/duplicate SKUs',()=>{
 const good={store:STORE,orderId:ORDER,confirmedBy:'Tony',lines:SKUS.map(sku=>({sku,receivedCases:1}))};assert.equal(validateRequest(good).length,4);
 for(const bad of [{...good,store:'Lynbrook'},{...good,orderId:'other'},{...good,confirmedBy:''},{...good,lines:good.lines.slice(1)},{...good,lines:[...good.lines.slice(1),good.lines[1]]},{...good,lines:good.lines.map(l=>({...l,receivedCases:2}))}])assert.throws(()=>validateRequest(bad));
});
test('selected receipt posts 60 once, omitted food/cases never fulfilled, full-order key stays unused',async t=>{
 const s=setup(t),svc=s.make();const a=await svc.run(s.req),b=await svc.run(s.req),c=await s.make().run(s.req);
 assert.equal(a.status,'selected_lines_posted');assert.equal(a.otherLines,'pending_unconfirmed');assert.equal(a.results.reduce((n,r)=>n+r.postedUnits,0),60);
 assert.deepEqual(a.results,b.results);assert.deepEqual(b.results,c.results);assert.deepEqual(s.counts(),{fulfilled:1,conversions:4,activations:8,credits:4});
 assert.equal(fs.existsSync(path.join(s.deps.dir,'completion-fulfillments-v1.json')),false);
 assert.equal(Object.keys(s.canonical).length,4);assert.ok(SKUS.every(sku=>s.canonical[receiptKey(STORE,ORDER,sku)]));
});
test('concurrent retries serialize and reuse the same four canonical keys',async t=>{const s=setup(t),svc=s.make();await Promise.all([svc.run(s.req),svc.run(s.req)]);assert.equal(s.counts().fulfilled,1);assert.equal(s.counts().conversions,4);});
test('lost fulfillment response after write reconciles, never creates second fulfillment',async t=>{const s=setup(t,{failure:'lost-after'});await assert.rejects(s.make().run(s.req));const r=await s.make().run(s.req);assert.equal(r.status,'selected_lines_posted');assert.equal(s.counts().fulfilled,1);});
test('uncertain request without proof never retries fulfillment',async t=>{const s=setup(t,{failure:'lost-before'});await assert.rejects(s.make().run(s.req));await assert.rejects(s.make().run(s.req),/uncertain/);assert.equal(s.counts().fulfilled,1);assert.equal(s.counts().conversions,0);});
test('interrupted conversion resumes existing case credit without duplication',async t=>{const s=setup(t,{failure:'conversion'});await assert.rejects(s.make().run(s.req));const r=await s.make().run(s.req);assert.equal(r.status,'selected_lines_posted');assert.equal(s.counts().credits,4);assert.equal(s.counts().conversions,4);});
test('activation preserves nonzero retained stock and stops for reconciliation',async t=>{const s=setup(t,{priorBalance:7});await assert.rejects(s.make().run(s.req),/Preserved stock/);assert.equal(s.counts().fulfilled,0);assert.equal(s.counts().conversions,0);});
test('fresh exact manual history review required, inactive never assumed zero',async t=>{
 for(const change of [r=>delete r.historyReview,r=>r.historyReview.checkedAt='2020-01-01',r=>r.historyReview.lines[0].salesUnits=1,r=>r.historyReview.lines[0].priorReceiptUnits=15,r=>r.historyReview.locationId='wrong']){const s=setup(t);change(s.req);await assert.rejects(s.make().run(s.req),/history/);assert.equal(s.counts().activations,0);}
});
test('prior canonical conversions or any order credit require review before new receipt',async t=>{const s=setup(t);s.canonical[receiptKey(STORE,ORDER,SKUS[0])]={status:'posted'};await assert.rejects(s.make().run(s.req),/Prior/);assert.equal(s.counts().fulfilled,0);});
test('wrong destination, warehouse, edited quantities and pagination are blocked',async t=>{
 for(const change of [o=>o.customer.tags=['Hummus Fit Lynbrook'],o=>o.fulfillmentOrders.nodes[0].assignedLocation.location.id='wrong',o=>o.lineItems.nodes[0].currentQuantity=0,o=>o.lineItems.pageInfo.hasNextPage=true,o=>o.fulfillmentOrders.pageInfo.hasNextPage=true]){const s=setup(t);change(s.order);await assert.rejects(s.make().run(s.req));assert.equal(s.counts().fulfilled,0);}
});
test('exact adjustment proof rejects wrong delta or extra inventory changes',async t=>{const s=setup(t);const r=await s.make().run(s.req);const entry=s.canonical[receiptKey(STORE,ORDER,SKUS[0])];const group={id:entry.adjustmentId,referenceDocumentUri:entry.plan.input.referenceDocumentUri,changes:entry.plan.input.changes.map(c=>({name:'available',delta:c.delta,item:{id:c.inventoryItemId},location:{id:locationId}}))};verifyConversion(group,entry,locationId);group.changes[1].delta=14;assert.throws(()=>verifyConversion(group,entry,locationId));});
test('no persistent volume means no receipt, fulfillment or inventory mutation',async t=>{const s=setup(t);s.deps.durable=false;await assert.rejects(s.make().run(s.req),/Persistent/);assert.equal(s.counts().fulfilled,0);});
