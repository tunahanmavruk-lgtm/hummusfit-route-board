const {workflowCompletion}=require('./picking-workflow');
const DAY_MS=86400000;
const formatter=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
function easternParts(value){
  const time=Date.parse(value);if(!Number.isFinite(time))return null;
  const p=Object.fromEntries(formatter.formatToParts(time).map(x=>[x.type,x.value]));
  return {day:Math.floor(Date.UTC(+p.year,+p.month-1,+p.day)/DAY_MS),hour:+p.hour};
}
function deliveryDate(source){
  // Local orders placed from noon onward are for the following morning,
  // matching the existing local route window. Do not label an old archive
  // with the browser's calendar date.
  const dates=(source?.orders?.length?source.orders:[source]).map(o=>easternParts(o?.createdAt));
  if(!dates.length||dates.some(d=>!d))return null;
  const days=dates.map(d=>d.day+(d.hour>=12?1:0));
  if(new Set(days).size!==1)return null;
  return new Date(days[0]*DAY_MS).toISOString().slice(0,10);
}
const orderKey=value=>String(value||'').split(',').map(x=>x.trim()).sort().join(',');
function selectReceivingDelivery({order,liveRecord,essentialsRecord,archive,localStore,separationEnabled=false,now=new Date()}){
  const today=new Date(easternParts(now.toISOString()).day*DAY_MS).toISOString().slice(0,10);
  const eligible=s=>!localStore||deliveryDate(s)===today;
  const liveMatches=order&&liveRecord?.completedAt&&orderKey(order.orderId)===orderKey(liveRecord.orderId)&&
    (!localStore||workflowCompletion(order,liveRecord,essentialsRecord&&orderKey(essentialsRecord.orderId)===orderKey(order.orderId)?essentialsRecord:null,separationEnabled).allComplete);
  const archivedMatches=archive?.completedAt&&Array.isArray(archive.lineItems)&&eligible(archive);
  // A new order for this delivery must finish picking before it can replace
  // the immutable completed snapshot. Never combine another order's lines
  // with an earlier order's picking record.
  if(localStore&&order&&eligible(order)&&(!archivedMatches||orderKey(archive.orderId)!==orderKey(order.orderId))&&!liveMatches)return null;
  if(archivedMatches&&(!order||!eligible(order)||orderKey(archive.orderId)===orderKey(order.orderId)))return {record:archive,source:archive,essentialsRecord:archive.essentialsRecord};
  if(liveMatches&&eligible(order))return {record:liveRecord,source:order,essentialsRecord};
  return archivedMatches?{record:archive,source:archive,essentialsRecord:archive.essentialsRecord}:null;
}
module.exports={deliveryDate,selectReceivingDelivery,orderKey};
