const test = require('node:test');
const assert = require('node:assert/strict');
const { createDepartureDetector, routeForDeparture } = require('../automatic-route-start');

const base = Date.parse('2026-10-30T08:00:00.000Z');
function vehicle(at, lat, lon, speed = 0, isRunning = false) {
  return { imei: 'van-1', stats: { lastUpdated: new Date(at).toISOString(),
    location: { lat, lon }, speed, isRunning } };
}

test('a fresh HQ fix followed by a moving fix outside HQ starts once', () => {
  const detect = createDepartureDetector();
  assert.equal(detect(vehicle(base, 40.8130, -73.1654), base), null);
  const away = vehicle(base + 60_000, 40.8130, -73.1770, 24, true);
  assert.deepEqual(detect(away, base + 60_000), {
    imei: 'van-1', departedAt: new Date(base + 60_000).toISOString(),
  });
  assert.equal(detect(away, base + 90_000), null);
  assert.equal(detect(vehicle(base + 120_000, 40.8130, -73.1850, 25, true), base + 120_000), null);
  // Route #2 can only start after a new HQ visit and a second departure.
  assert.equal(detect(vehicle(base + 180_000, 40.8130, -73.1654), base + 180_000), null);
  assert.ok(detect(vehicle(base + 240_000, 40.8130, -73.1770, 24, true), base + 240_000));
});

test('old GPS, an already-away van, and a non-running van do not start', () => {
  const detect = createDepartureDetector();
  assert.equal(detect(vehicle(base, 40.8130, -73.1770, 25, true), base), null);
  assert.equal(detect(vehicle(base + 60_000, 40.8130, -73.1654), base + 10 * 60_000), null);
  assert.equal(detect(vehicle(base + 11 * 60_000, 40.8130, -73.1654), base + 11 * 60_000), null);
  assert.equal(detect(vehicle(base + 12 * 60_000, 40.8130, -73.1770, 0, false), base + 12 * 60_000), null);
  assert.equal(detect(vehicle(base + 13 * 60_000, 40.8130, -73.1770, 25, true), base + 13 * 60_000)?.imei, 'van-1');
});

test('only an assigned, unstarted, scheduled route with an order can auto-start', () => {
  const local = { id: 'r1', stops: [{ name: 'Deer Park' }] };
  const tomorrow = { id: 'b2b-sat', day: 6, stops: [{ name: 'Rochelle' }] };
  const today = { id: 'b2b-fri', day: 5, stops: [{ name: 'Rochelle' }] };
  const state = { assignments: { r1: { van: 'Van A' }, 'b2b-sat': { van: 'Van A' },
    'b2b-fri': { van: 'Van B' } }, routeMeta: {} };
  const vehicles = { 'Van A': 'van-1', 'Van B': 'van-2' };
  const orders = { 'deer park': { isB2B: false }, rochelle: { isB2B: true } };
  assert.equal(routeForDeparture([local, tomorrow, today], state, orders, 'van-1', vehicles, 5, 8)?.id, 'r1');
  assert.equal(routeForDeparture([local, tomorrow, today], state, {}, 'van-1', vehicles, 5, 8), null);
  assert.equal(routeForDeparture([local, tomorrow, today], state, orders, 'other-van', vehicles, 5, 8), null);
  assert.equal(routeForDeparture([local, tomorrow, today], state, orders, 'van-1', vehicles, 5, 2), null);
  assert.equal(routeForDeparture([local, tomorrow, today], state, orders, 'van-1', vehicles, 5, 13), null);
  assert.equal(routeForDeparture([local, tomorrow, today], state, orders, 'van-2', vehicles, 5, 8)?.id, 'b2b-fri');
  state.routeMeta.r1 = { startedAt: new Date(base).toISOString() };
  assert.equal(routeForDeparture([local, tomorrow, today], state, orders, 'van-1', vehicles, 5, 8), null);
});

test('shared Route 1/Route 2 van uses separate departures; ambiguous assignments stay off', () => {
  const r1 = { id: 'r1', stops: [{ name: 'Deer Park' }] };
  const r2 = { id: 'r2', stops: [{ name: 'Bellmore' }] };
  const other = { id: 'r3', stops: [{ name: 'Farmingdale' }] };
  const state = { assignments: { r1: { van: 'Van A' }, r2: { van: 'Van A' }, r3: { van: 'Van A' } }, routeMeta: {} };
  const orders = Object.fromEntries(['deer park', 'bellmore', 'farmingdale'].map((key) => [key, { isB2B: false }]));
  assert.equal(routeForDeparture([r1, r2], state, orders, 'van-1', { 'Van A': 'van-1' }, 5, 8)?.id, 'r1');
  assert.equal(routeForDeparture([r1, r2, other], state, orders, 'van-1', { 'Van A': 'van-1' }, 5, 8), null);
  state.routeMeta.r1 = { startedAt: new Date(base).toISOString() };
  assert.equal(routeForDeparture([r1, r2], state, orders, 'van-1', { 'Van A': 'van-1' }, 5, 8)?.id, 'r2');
});
