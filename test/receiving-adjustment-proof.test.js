const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function handler(identity,tags,reference){
  const source=fs.readFileSync(require.resolve('../server.js'),'utf8');
  const start=source.indexOf('app.post("/api/receiving-adjustment-proof"');
  const end=source.indexOf('app.post("/api/essentials-pos-receipt"',start);
  let route,calls=0;
  vm.runInNewContext(source.slice(start,end),{
    app:{post:(url,fn)=>{route=fn;}},console,
    verifyLogisticsToken:()=>identity,POS_STORE_LOCATIONS:{'Miller Place':'Hummus Fit Miller Place'},
    shopifyGraphQL:async()=>{calls++;return {order:{id:'gid://shopify/Order/123',customer:{tags}}};},
    posShopifyGraphQL:async()=>{calls++;return {node:{referenceDocumentUri:reference}};},
  });
  return {route,calls:()=>calls};
}
const authorized={sub:'hummusfit-receiving'};
const group='gid://agent-hazar-receiving/FoodCorrection/abc';
async function invoke(h,body={groupId:'gid://shopify/InventoryAdjustmentGroup/123',orderId:'gid://shopify/Order/123'}){
  const res={code:200,status(n){this.code=n;return this;},json(data){this.data=data;return this;}};
  await h.route({get:()=>'',body},res);return res;
}
test('requires scoped receiving identity before any read',async()=>{const h=handler(null,[],group);assert.equal((await invoke(h)).code,403);assert.equal(h.calls(),0);});
test('rejects malformed resource identifiers',async()=>{const h=handler(authorized,[],group);assert.equal((await invoke(h,{})).code,400);assert.equal(h.calls(),0);});
test('refuses non-store orders before reading inventory proof',async()=>{const h=handler(authorized,['wholesale'],group);assert.equal((await invoke(h)).code,403);assert.equal(h.calls(),1);});
test('returns only receiving correction proof for approved store orders',async()=>{const h=handler(authorized,['HUMMUS FIT STORE','Hummus Fit Miller Place'],group);assert.equal((await invoke(h)).code,200);assert.equal(h.calls(),2);});
test('unrelated adjustment cannot be imported',async()=>{const h=handler(authorized,['HUMMUS FIT STORE','Hummus Fit Miller Place'],'gid://shopify/Order/123');assert.equal((await invoke(h)).code,409);});
