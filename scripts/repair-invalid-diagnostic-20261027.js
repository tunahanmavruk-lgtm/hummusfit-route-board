const fs=require('node:fs'),crypto=require('node:crypto');
const {createPosTokenProvider}=require('../shopify-pos-auth');
const {nextConversionKey}=require('../conversion-request-key');
const INCIDENT='invalid-diagnostic-20261027',JOURNAL='/data/invalid-diagnostic-reversals.json';
const ALLOWED=new Set(['68629608694007','68629608431863','68629608104183','68629609054455','68629614756087','68629627601143','68629627306231'].map(id=>'gid://shopify/InventoryAdjustmentGroup/'+id));
const READ=`query DiagnosticRepairProof($groupId:ID!,$a:ID!,$b:ID!,$location:ID!){node(id:$groupId){... on InventoryAdjustmentGroup{id createdAt referenceDocumentUri changes(quantityNames:["available"]){name delta item{id} location{id}}}} a:inventoryItem(id:$a){id inventoryLevel(locationId:$location){quantities(names:["available"]){name quantity}}} b:inventoryItem(id:$b){id inventoryLevel(locationId:$location){quantities(names:["available"]){name quantity}}}}`;
const ADJUST=`mutation ReverseInvalidDiagnostic($input:InventoryAdjustQuantitiesInput!,$key:String!){inventoryAdjustQuantities(input:$input) @idempotent(key:$key){inventoryAdjustmentGroup{id} userErrors{field message}}}`;
function check(value,message){if(!value)throw new Error(message);}
function verifyChanges(group,id,reference,changes){
  check(group?.id===id&&group.referenceDocumentUri===reference&&group.changes?.length===changes.length,'Adjustment identity or reference mismatch');
  for(const c of changes)check(group.changes.filter(g=>g.name==='available'&&g.item?.id===c.inventoryItemId&&g.location?.id===c.locationId&&g.delta===c.delta).length===1,'Exact inventory delta proof mismatch');
}
function write(file,value){const temp=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2));fs.renameSync(temp,file);}
async function main(){
  const execute=process.argv.includes('--execute'),backup='/data/backups/'+INCIDENT+'/original-conversions.json';
  check(fs.existsSync(backup),'Verified containment backup is required');
  const originals=JSON.parse(fs.readFileSync(backup));check(Object.keys(originals).length===7,'Exactly seven conversions required');
  const shop=process.env.SHOPIFY_STORE_DOMAIN||process.env.SHOPIFY_SHOP_DOMAIN;
  const token=createPosTokenProvider({shop,clientId:process.env.SHOPIFY_POS_CLIENT_ID,clientSecret:process.env.SHOPIFY_POS_CLIENT_SECRET});
  async function gql(query,variables){const response=await fetch('https://'+shop+'/admin/api/2026-10/graphql.json',{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':await token()},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(30000)});const result=await response.json();check(response.ok&&!result.errors?.length&&result.data,'Shopify did not confirm the repair request: '+JSON.stringify(result.errors||{}));return result.data;}
  const journal=fs.existsSync(JOURNAL)?JSON.parse(fs.readFileSync(JOURNAL)):{};
  const summary=[];
  for(const [key,original]of Object.entries(originals)){
    check(ALLOWED.has(original.adjustmentId)&&key===crypto.createHash('sha256').update(JSON.stringify([original.store,original.orderId,original.caseSku])).digest('hex'),'Conversion is outside the exact incident scope');
    const changes=original.plan.input.changes;check(changes.length===2&&changes[0].locationId===changes[1].locationId,'Exact case/unit location required');
    const variables={groupId:original.adjustmentId,a:changes[0].inventoryItemId,b:changes[1].inventoryItemId,location:changes[0].locationId};
    const before=await gql(READ,variables);verifyChanges(before.node,original.adjustmentId,original.plan.input.referenceDocumentUri,changes);
    let entry=journal[key];
    if(!entry){
      const quantities=[before.a,before.b].map(i=>i?.inventoryLevel?.quantities?.find(q=>q.name==='available')?.quantity);
      check(quantities.every(Number.isSafeInteger),'Current case and sell-unit quantities required');
      entry={status:'held',originalAdjustmentId:original.adjustmentId,store:original.store,orderId:original.orderId,caseSku:original.caseSku,nextRequestKey:nextConversionKey(key),
        reversalRequestKey:crypto.createHash('sha256').update('reverse-'+INCIDENT+':'+key).digest('hex'),
        input:{name:'available',reason:'correction',referenceDocumentUri:'gid://hummusfit-receiving/DiagnosticReversal/'+key,changes:changes.map((c,index)=>({inventoryItemId:c.inventoryItemId,locationId:c.locationId,delta:-c.delta,changeFromQuantity:quantities[index]}))}};
      if(execute){journal[key]=entry;write(JOURNAL,journal);}
    }
    if(execute&&entry.status!=='reversed_verified'){
      const result=(await gql(ADJUST,{input:entry.input,key:entry.reversalRequestKey})).inventoryAdjustQuantities;
      check(result?.inventoryAdjustmentGroup?.id&&!result.userErrors?.length,'Compensating adjustment not confirmed: '+JSON.stringify(result?.userErrors||{}));
      entry.reversalAdjustmentId=result.inventoryAdjustmentGroup.id;entry.status='awaiting_verification';write(JOURNAL,journal);
      const proof=await gql(READ,{...variables,groupId:entry.reversalAdjustmentId});verifyChanges(proof.node,entry.reversalAdjustmentId,entry.input.referenceDocumentUri,entry.input.changes);
      entry.status='reversed_verified';entry.verifiedAt=new Date().toISOString();write(JOURNAL,journal);
    }
    summary.push({store:original.store,sku:original.caseSku,originalAdjustmentId:original.adjustmentId,status:execute?entry.status:'preflight_verified',reversalAdjustmentId:entry.reversalAdjustmentId,unitDelta:entry.input.changes[1].delta});
  }
  console.log(JSON.stringify({execute,summary}));
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={READ,ADJUST,verifyChanges};
