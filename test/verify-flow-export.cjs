// Read-only comparison of official Flow exports; never edits a .flow file.
const fs=require('node:fs'),assert=require('node:assert/strict');
const read=file=>{const s=fs.readFileSync(file,'utf8');return JSON.parse(s.slice(s.indexOf(':')+1)).root;};
const [beforeFile,afterFile]=process.argv.slice(2),a=read(beforeFile),b=read(afterFile);
const config=s=>Object.fromEntries(s.config_field_values.map(v=>[v.config_field_id,v.value]));
const stores=['Holbrook','Islip','Bellmore','Lake Grove','Deer Park','Farmingdale','Huntington','Island Park','Lindenhurst','Lynbrook','Ronkonkoma','Selden','Woodbury','Miller Place'];
const oldWrites=a.steps.filter(s=>JSON.stringify(s.config_field_values).includes('inventoryAdjustQuantities'));
assert.equal(oldWrites.length,13);assert.equal(b.steps.filter(s=>JSON.stringify(s.config_field_values).includes('inventoryAdjustQuantities')).length,0);
const removed=new Set(oldWrites.map(s=>s.step_id));
assert.equal(b.steps.length,a.steps.length-13);assert.equal(b.links.length,a.links.length-13);
for(const step of a.steps.filter(s=>!removed.has(s.step_id)&&s.task_id!=='shopify::flow::send_http')){
 const next=b.steps.find(s=>s.step_id===step.step_id);assert.ok(next);assert.deepEqual(config(next),config(step));assert.equal(next.task_id,step.task_id);
}
const expectedLinks=a.links.filter(l=>!removed.has(l.from_step_id)&&!removed.has(l.to_step_id));
for(const old of oldWrites){
 const incoming=a.links.filter(l=>l.to_step_id===old.step_id),outgoing=a.links.filter(l=>l.from_step_id===old.step_id);
 assert.equal(incoming.length,1);assert.equal(outgoing.length,1);assert.equal(incoming[0].from_port_id,'loop_body');
 expectedLinks.push({...incoming[0],to_step_id:outgoing[0].to_step_id,to_port_id:outgoing[0].to_port_id});
}
const sorted=links=>links.map(l=>JSON.stringify(l)).sort();assert.deepEqual(sorted(b.links),sorted(expectedLinks));
const verified=[];
for(let n=0;n<stores.length;n++){
 const name='Send HTTP request'+(n?' ('+n+')':''),old=a.steps.find(s=>s.name===name),step=b.steps.find(s=>s.step_id===old.step_id);
 const prev=config(old),next=config(step);
 for(const k of Object.keys(prev).filter(k=>k!=='body'))assert.equal(next[k],prev[k],name+' '+k);
 const body=JSON.parse(next.body);assert.equal(body.store,stores[n]);assert.equal(body.mode,n===6?'huntington_fulfillment_v1':'store_fulfillment_v1');
 const clean=s=>s.replace(/\s/g,'');
 assert.equal(clean(body.orderId),'{{order.id}}');assert.equal(clean(body.fulfillmentId),'{{fulfillment.id}}');assert.equal(clean(body.lineItemId),'{{lineItemsForeachitem.id}}');assert.equal(body.adjustmentGroupId,undefined);
 if(n===6)assert.deepEqual(next,prev,'Huntington must remain unchanged');
 verified.push({store:stores[n],callback:name,directLoop:true,legacyWrite:false});
}
console.log(JSON.stringify({verifiedAt:new Date().toISOString(),beforeFile,afterFile,stores:verified,unchangedConditionsLoopsTrigger:true,unchangedHuntington:true,legacyWritesRemoved:13},null,2));
