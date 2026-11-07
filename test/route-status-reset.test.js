const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const loadSource = source.slice(source.indexOf('function loadState() {'), source.indexOf('function saveState(state) {'));
const currentWindow = '2026-11-06T17:00:00.000Z';
const routes = [
  {id:'r4',stops:[{id:'r4-1'},{id:'r4-2'},{id:'r4-swap-lake-grove'}]},
  {id:'r5',defaultDriver:'Driver',stops:[{id:'r5-lake-grove-v2'}]},
];
const b2b = [
  {id:'b2b-thu',day:4,stops:[{id:'b2b-thu-1'}]},
  {id:'b2b-fri',day:5,stops:[{id:'b2b-fri-1'}]},
];
function fixture() {
  return {
    day:'2026-11-07',deliveryWindowStart:currentWindow,
    assignments:{r4:{van:'Van',driver:'Driver'},'b2b-thu':{van:'Van',driver:'Driver'}},
    routeMeta:{r4:{startedAt:'previous'},'b2b-thu':{startedAt:'b2b'}},
    stopStatus:{
      r4:{status:'picked'}, // legacy route-keyed state
      'r4-1':{status:'delivered'},'r4-2':{status:'picked',pickedAt:'previous'},
      'r4-swap-lake-grove':{status:'arrived'},
      'r5-lake-grove-v2':{status:'delivered'},
      'b2b-thu-1':{status:'picked'},'b2b-fri-1':{status:'enroute'},
    },
    picking:{'miller place':{orderId:'real-order',startedAt:'night',itemScannedCount:{FOOD:6}}},
    essentialsPicking:{'miller place':{orderId:'real-order',completedAt:'saved',itemScannedCount:{CASE:1}}},
    b2bLastResetDate:{'b2b-thu':'next-occurrence','b2b-fri':'next-occurrence'},
  };
}
function run(state, {window=currentWindow,today='2026-11-07',occurrence='next-occurrence'}={}) {
  const writes=[];
  const context={
    fs:{readFileSync(){return JSON.stringify(state);}},DATA_FILE:'in-memory-only',
    ROUTES:routes,B2B_ROUTES:b2b,
    todayEastern:()=>today,todayEasternFor:()=>occurrence,getEasternWeekday:()=>6,
    getOrderWindowEastern:()=>({windowStart:new Date(window)}),
    canonicalVehicleName:value=>value,
    saveState:value=>writes.push(JSON.parse(JSON.stringify(value))),
    defaultState:()=>{throw Error('loadState unexpectedly failed');},
  };
  vm.createContext(context);
  vm.runInContext(loadSource+'\nresult = loadState();',context);
  return {state:JSON.parse(JSON.stringify(context.result)),writes};
}
test('a new local window removes actual stop statuses including Miller Place, not picking records',()=>{
  const before=fixture(),{state,writes}=run(before,{window:'2026-11-07T17:00:00.000Z'});
  for(const route of routes)for(const stop of route.stops)assert.equal(state.stopStatus[stop.id],undefined,stop.id+' must not inherit a previous picked/delivered label');
  assert.equal(state.stopStatus.r4,undefined);
  assert.deepEqual(state.stopStatus['b2b-thu-1'],before.stopStatus['b2b-thu-1']);
  assert.deepEqual(state.stopStatus['b2b-fri-1'],before.stopStatus['b2b-fri-1']);
  assert.deepEqual(state.picking,before.picking);
  assert.deepEqual(state.essentialsPicking,before.essentialsPicking);
  assert.deepEqual(state.assignments.r5,{van:'',driver:'Driver'});
  assert.equal(state.routeMeta.r4,undefined);
  assert.ok(writes.length);
});
test('same-window reads retain current picked and delivered status without writes',()=>{
  const before=fixture(),{state,writes}=run(before);
  assert.deepEqual(state,before);assert.equal(writes.length,0);
});
test('midnight alone preserves overnight picking and same-window route progress',()=>{
  const before=fixture();before.day='2026-11-06';
  const {state}=run(before);
  assert.equal(state.day,'2026-11-07');
  assert.deepEqual(state.stopStatus,before.stopStatus);
  assert.deepEqual(state.picking,before.picking);
  assert.deepEqual(state.essentialsPicking,before.essentialsPicking);
});
test('a B2B occurrence reset clears only that route and keeps local delivery evidence',()=>{
  const before=fixture();before.b2bLastResetDate['b2b-thu']='prior-occurrence';
  const {state}=run(before);
  assert.equal(state.stopStatus['b2b-thu-1'],undefined);
  assert.deepEqual(state.stopStatus['b2b-fri-1'],before.stopStatus['b2b-fri-1']);
  for(const route of routes)for(const stop of route.stops)assert.deepEqual(state.stopStatus[stop.id],before.stopStatus[stop.id]);
  assert.deepEqual(state.picking,before.picking);
  assert.deepEqual(state.essentialsPicking,before.essentialsPicking);
});
test('repeated reads after reset keep newly recorded progress',()=>{
  const first=run(fixture(),{window:'2026-11-07T17:00:00.000Z'}).state;
  first.stopStatus['r4-2']={status:'picked',pickedAt:'current'};
  const {state,writes}=run(first,{window:'2026-11-07T17:00:00.000Z'});
  assert.deepEqual(state,first);assert.equal(writes.length,0);
});
