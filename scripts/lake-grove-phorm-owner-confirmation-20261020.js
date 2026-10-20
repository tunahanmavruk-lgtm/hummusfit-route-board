#!/usr/bin/env node
// One-time owner-confirmed physical receipt. This is NOT a staff Receiving
// report, fulfillment, or pick. The fourth flavor remains source-unlinked.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {createPosTokenProvider} = require('../shopify-pos-auth');
const {VERIFIED_CASE_MAPPINGS,receiptKey,adjustmentPlan} = require('../essentials-pos-conversion');
const {readConversionLedger,writeConversionLedger} = require('../retail-conversion-ledger');

const STORE='Lake Grove', ORDER='gid://shopify/Order/8083743506679';
const LOCATION='gid://shopify/Location/97226490103', WAREHOUSE='gid://shopify/Location/103133642999';
const ORDERED=['MF-7171015-CS','MF-7171013-CS','MF-7171008-CS'];
const EXTRA='MF-7171000-CS', CONFIRMATION='LakeGrove::Tony::four-full-phorm-bar-boxes::2026-10-20';
const DATA=process.env.HF_RECOVERY_DATA_DIR || '/data';
const HASH=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ORDER_QUERY=`query OwnerConfirmedLakeGroveOrder($id:ID!){order(id:$id){id name cancelledAt customer{tags} lineItems(first:250){nodes{id sku quantity variant{id inventoryItem{id}}} pageInfo{hasNextPage}} fulfillments(first:100){id status location{id} fulfillmentLineItems(first:250){nodes{quantity lineItem{id}} pageInfo{hasNextPage}}}}}`;
const VARIANT_QUERY=`query OwnerConfirmedLakeGroveVariants($ids:[ID!]!,$locationId:ID!){nodes(ids:$ids){... on ProductVariant{id sku barcode price product{status tags} inventoryItem{id sku tracked duplicateSkuCount unitCost{amount} inventoryLevel(locationId:$locationId){quantities(names:["available"]){name quantity}}}}}}`;
const GROUP_QUERY=`query OwnerConfirmedLakeGroveGroup($id:ID!){node(id:$id){... on InventoryAdjustmentGroup{id referenceDocumentUri changes{name delta item{id} location{id}}}}}`;
const ADJUST=`mutation OwnerConfirmedLakeGroveAdjustment($input:InventoryAdjustQuantitiesInput!,$key:String!){inventoryAdjustQuantities(input:$input) @idempotent(key:$key){inventoryAdjustmentGroup{id} userErrors{field message}}}`;

function check(ok,message){if(!ok)throw new Error(message);}
function readOwner(file){try{const x=JSON.parse(fs.readFileSync(file,'utf8'));check(x&&!Array.isArray(x),'Invalid owner confirmation ledger');return x;}catch(e){if(e.code==='ENOENT')return {};throw e;}}
function writeOwner(file,all){const tmp=file+'.'+process.pid+'.tmp',fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(all,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
function available(variant){return variant?.inventoryItem?.inventoryLevel?.quantities?.find(x=>x.name==='available')?.quantity;}
function proveGroup(group,reference,changes){const actual=(group?.changes||[]).filter(x=>x.name==='available');check(/^gid:\/\/shopify\/InventoryAdjustmentGroup\/\d+$/.test(group?.id||'')&&group.referenceDocumentUri===reference&&actual.length===changes.length&&changes.every(want=>actual.filter(got=>got.item?.id===want.inventoryItemId&&got.location?.id===want.locationId&&got.delta===want.delta).length===1),'Exact Shopify inventory adjustment proof does not match');}

async function main(){
  const apply=process.argv.includes('--apply');
  check(fs.existsSync(DATA),'Persistent receipt volume unavailable');
  if(apply)check(DATA==='/data'&&!!process.env.RAILWAY_ENVIRONMENT_ID,'Apply only inside production with the durable receipt volume');
  const shop=process.env.SHOPIFY_STORE_DOMAIN;
  const getToken=createPosTokenProvider({shop,clientId:process.env.SHOPIFY_POS_CLIENT_ID,clientSecret:process.env.SHOPIFY_POS_CLIENT_SECRET});
  async function gql(query,variables,admin=false){const token=admin?process.env.SHOPIFY_ADMIN_ACCESS_TOKEN:await getToken();check(!!token,'Shopify credential unavailable');const res=await fetch(`https://${shop}/admin/api/${admin?'2026-07':'2026-10'}/graphql.json`,{method:'POST',headers:{'content-type':'application/json','x-shopify-access-token':token},body:JSON.stringify({query,variables})});const body=await res.json();check(res.ok&&!body.errors&&body.data,'Shopify GraphQL failed: '+JSON.stringify(body.errors||{status:res.status}));return body.data;}
  const order=(await gql(ORDER_QUERY,{id:ORDER},true)).order;
  check(order?.id===ORDER&&order.name==='#769798'&&!order.cancelledAt&&order.lineItems?.pageInfo?.hasNextPage===false&&order.customer?.tags?.includes('Hummus Fit Lake Grove'),'Exact Lake Grove order is required');
  const fulfilled=new Map();
  for(const f of order.fulfillments||[]){check(f.status==='SUCCESS'&&f.location?.id===WAREHOUSE&&f.fulfillmentLineItems?.pageInfo?.hasNextPage===false,'Exact Shipping Warehouse fulfillment required');for(const l of f.fulfillmentLineItems.nodes)fulfilled.set(l.lineItem.id,(fulfilled.get(l.lineItem.id)||0)+l.quantity);}
  for(const sku of ORDERED){const lines=order.lineItems.nodes.filter(l=>l.sku===sku);check(lines.length===1&&lines[0].quantity===1&&fulfilled.get(lines[0].id)===1&&lines[0].variant?.id===VERIFIED_CASE_MAPPINGS[sku].caseVariantId,'Fulfilled bar case changed: '+sku);}
  check(!order.lineItems.nodes.some(l=>l.sku===EXTRA),'Pretzel must remain an off-order physical count');
  const mappings=[...ORDERED,EXTRA].map(sku=>({sku,...VERIFIED_CASE_MAPPINGS[sku]}));
  const ids=mappings.flatMap(m=>[m.caseVariantId,m.unitVariantId]);
  const variants=(await gql(VARIANT_QUERY,{ids,locationId:LOCATION})).nodes;
  check(variants.length===8&&variants.every(Boolean),'Complete approved bar catalog required');
  const byId=new Map(variants.map(v=>[v.id,v]));
  for(const m of mappings){const c=byId.get(m.caseVariantId),u=byId.get(m.unitVariantId);check(c?.sku===m.sku&&u?.sku===m.unitSku&&u.barcode===m.unitBarcode&&u.product?.status==='ACTIVE'&&c.product?.tags?.includes('retail-essentials')&&u.product?.tags?.includes('pos-unit')&&c.inventoryItem?.tracked&&u.inventoryItem?.tracked&&c.inventoryItem?.duplicateSkuCount===0&&u.inventoryItem?.duplicateSkuCount===0&&m.unitsPerCase===15,'Approved 15-bar mapping changed: '+m.sku);check(Number(c.inventoryItem.unitCost?.amount)>0&&Number(u.price)>Number(c.inventoryItem.unitCost.amount)/15,'Bar price or cost needs review: '+m.sku);}
  const creditLedger=readOwner(path.join(DATA,'huntington-fulfillment-credits-v1.json'));
  for(const sku of ORDERED){const c=byId.get(VERIFIED_CASE_MAPPINGS[sku].caseVariantId);const matches=Object.values(creditLedger).filter(e=>e.store===STORE&&e.orderId===ORDER&&e.sku===sku);check(matches.length===1&&matches[0].status==='posted'&&matches[0].quantity===1&&matches[0].inventoryItemId===c.inventoryItem.id,'One exact posted case credit required: '+sku);const g=(await gql(GROUP_QUERY,{id:matches[0].adjustmentId})).node;proveGroup(g,matches[0].input.referenceDocumentUri,[{inventoryItemId:c.inventoryItem.id,locationId:LOCATION,delta:1}]);}
  const file=path.join(DATA,'essentials-pos-receipts.json'),ownerFile=path.join(DATA,'lake-grove-phorm-owner-confirmation-v1.json');
  let canonical=readConversionLedger(file),owner=readOwner(ownerFile);
  check(!owner[CONFIRMATION]||owner[CONFIRMATION].orderId===ORDER&&owner[CONFIRMATION].confirmedBy==='Tony'&&owner[CONFIRMATION].cases?.length===4,'Owner confirmation changed');
  for(const m of mappings){const c=byId.get(m.caseVariantId),u=byId.get(m.unitVariantId),key=receiptKey(STORE,ORDER,m.sku),prior=canonical[key];
    if(m.sku===EXTRA){check(available(c)===undefined,'Unlinked Pretzel case must not already have a store credit');check(available(u)===0||!!owner[CONFIRMATION]?.extra?.input,'Pretzel unit balance changed');continue;}
    if(prior){check(prior.store===STORE&&prior.orderId===ORDER&&prior.caseSku===m.sku&&prior.plan?.receivedCases===1&&prior.plan?.units===15,'Existing conversion is inconsistent: '+m.sku);if(prior.status==='posted'){proveGroup((await gql(GROUP_QUERY,{id:prior.adjustmentId})).node,prior.plan.input.referenceDocumentUri,prior.plan.input.changes);continue;}check(prior.status==='pending'&&Date.now()-prior.startedAt<23*3600000,'Uncertain old conversion needs review: '+m.sku);}
    else check(available(c)===1&&available(u)===0,'Expected one credited case and zero units before conversion: '+m.sku);
  }
  if(!apply){console.log(JSON.stringify({ready:true,orderedConversions:ORDERED,unlinkedPhysicalCount:EXTRA,unitsPerFlavor:15,existing:ORDERED.map(sku=>({sku,status:canonical[receiptKey(STORE,ORDER,sku)]?.status||'unposted'})),ownerConfirmation:owner[CONFIRMATION]?.status||'unposted'}));return;}
  if(!owner[CONFIRMATION]){owner[CONFIRMATION]={id:CONFIRMATION,store:STORE,orderId:ORDER,confirmedBy:'Tony',confirmedAt:'2026-10-20',source:'direct owner confirmation in Codex',cases:mappings.map(m=>({caseSku:m.sku,receivedCases:1,unitsPerCase:15})),extra:{caseSku:EXTRA,source:'unlinked physical extra',status:'pending'}};writeOwner(ownerFile,owner);}
  for(const m of mappings.filter(m=>m.sku!==EXTRA)){
    const key=receiptKey(STORE,ORDER,m.sku);canonical=readConversionLedger(file);let entry=canonical[key];if(entry?.status==='posted')continue;
    if(!entry){const c=byId.get(m.caseVariantId),u=byId.get(m.unitVariantId);const plan=adjustmentPlan({...m,caseSku:m.sku,receivedCases:1},{id:c.inventoryItem.id,available:available(c),unitCost:Number(c.inventoryItem.unitCost.amount),mappingPending:false},{id:u.inventoryItem.id,available:available(u),price:Number(u.price)},LOCATION,key);entry={status:'pending',store:STORE,orderId:ORDER,caseSku:m.sku,plan,startedAt:Date.now(),ownerConfirmationId:CONFIRMATION};canonical[key]=entry;writeConversionLedger(file,canonical);}
    const result=(await gql(ADJUST,{input:entry.plan.input,key})).inventoryAdjustQuantities;check(!result?.userErrors?.length&&result?.inventoryAdjustmentGroup?.id,'Shopify rejected case conversion: '+m.sku);
    const group=(await gql(GROUP_QUERY,{id:result.inventoryAdjustmentGroup.id})).node;proveGroup(group,entry.plan.input.referenceDocumentUri,entry.plan.input.changes);
    canonical=readConversionLedger(file);canonical[key]={...entry,status:'posted',units:15,adjustmentId:group.id};writeConversionLedger(file,canonical);
  }
  owner=readOwner(ownerFile);let extra=owner[CONFIRMATION].extra;
  if(extra.status==='posted')proveGroup((await gql(GROUP_QUERY,{id:extra.adjustmentId})).node,extra.input.referenceDocumentUri,extra.input.changes);
  if(extra.status!=='posted'){
    const m=mappings.find(x=>x.sku===EXTRA),u=byId.get(m.unitVariantId);const key=HASH([CONFIRMATION,m.unitSku]);
    if(!extra.input){check(available(u)===0,'Pretzel units changed since owner preflight');extra={...extra,status:'pending',key,startedAt:Date.now(),input:{name:'available',reason:'correction',referenceDocumentUri:`gid://hummusfit-receiving/OwnerPhysicalCount/${key}`,changes:[{inventoryItemId:u.inventoryItem.id,locationId:LOCATION,delta:15,changeFromQuantity:0}]}};owner[CONFIRMATION].extra=extra;writeOwner(ownerFile,owner);}
    check(Date.now()-extra.startedAt<23*3600000,'Uncertain Pretzel adjustment needs Shopify review');
    const result=(await gql(ADJUST,{input:extra.input,key:extra.key})).inventoryAdjustQuantities;check(!result?.userErrors?.length&&result?.inventoryAdjustmentGroup?.id,'Shopify rejected Pretzel physical count');
    const group=(await gql(GROUP_QUERY,{id:result.inventoryAdjustmentGroup.id})).node;proveGroup(group,extra.input.referenceDocumentUri,extra.input.changes);
    owner=readOwner(ownerFile);owner[CONFIRMATION].extra={...extra,status:'posted',adjustmentId:group.id};writeOwner(ownerFile,owner);
  }
  owner=readOwner(ownerFile);owner[CONFIRMATION].status='posted';owner[CONFIRMATION].verifiedAt=new Date().toISOString();writeOwner(ownerFile,owner);
  console.log(JSON.stringify({status:'posted',ordered:ORDERED.map(sku=>({sku,adjustmentId:readConversionLedger(file)[receiptKey(STORE,ORDER,sku)].adjustmentId})),extra:{sku:EXTRA,adjustmentId:owner[CONFIRMATION].extra.adjustmentId},staffReportCreated:false}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
