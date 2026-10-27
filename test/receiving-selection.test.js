const test=require('node:test'),assert=require('node:assert/strict');
const {deliveryDate,selectReceivingDelivery}=require('../receiving-selection');
const now=new Date('2026-10-27T14:00:00Z');
function archived(createdAt='2026-10-26T20:00:00Z'){return {orderId:'gid://shopify/Order/1',orderName:'#1',createdAt,completedAt:'2026-10-27T01:00:00Z',lineItems:[{title:'Food',sku:'FOOD',quantity:2}]};}
const select=opts=>selectReceivingDelivery({localStore:true,now,...opts});
test('overnight picking remains the current delivery all day, including after board cutoff',()=>{
 const archive=archived();assert.equal(deliveryDate(archive),'2026-10-27');
 assert.equal(select({archive}).source,archive);
 assert.equal(select({archive,now:new Date('2026-10-27T23:00:00Z')}).source,archive);
});
test('old archive cannot masquerade as today when no new pick has completed',()=>{
 assert.equal(select({archive:archived('2026-10-25T20:00:00Z')}),null);
 const order={...archived(),orderId:'gid://shopify/Order/2'};
 assert.equal(select({archive:archived('2026-10-25T20:00:00Z'),order,liveRecord:{orderId:order.orderId}}),null);
});
test('mismatched live picking never supplies another orders lines or identity',()=>{
 const order={...archived(),orderId:'gid://shopify/Order/2'},liveRecord=archived();
 assert.equal(select({order,liveRecord,archive:archived('2026-10-25T20:00:00Z')}),null);
});
test('tomorrows new order does not displace todays completed delivery',()=>{
 const archive=archived(),order=archived('2026-10-27T20:00:00Z');order.orderId='gid://shopify/Order/2';
 assert.equal(select({archive,order}).source,archive);
});
test('B2B still uses its completed archive without local daily expiry',()=>{
 const archive=archived('2026-10-22T20:00:00Z');assert.equal(select({archive,localStore:false}).source,archive);
});
test('delivery date follows Eastern calendar across DST and rejects mixed daily order sets',()=>{
 assert.equal(deliveryDate(archived('2026-10-31T22:00:00Z')),'2026-11-01');
 assert.equal(deliveryDate(archived('2026-11-01T22:00:00Z')),'2026-11-02');
 assert.equal(deliveryDate({orders:[{createdAt:'2026-10-26T20:00:00Z'},{createdAt:'2026-10-27T20:00:00Z'}]}),null);
});
