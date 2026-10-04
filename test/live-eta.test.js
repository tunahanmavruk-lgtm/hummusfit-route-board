const assert = require('node:assert/strict');
const test = require('node:test');
const { remainingStopEtas } = require('../live-eta.js');
const route = { stops: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
const meta = { optimizedStopIds: ['a', 'b', 'c'], legDurationsSeconds: [600, 900, 1200] };
const now = Date.parse('2026-10-05T14:00:00Z');

test('live GPS/traffic leg shifts all remaining ETAs and keeps planned stop order', () => {
  const result = remainingStopEtas(meta, route, {}, 300, 18 * 60, now);
  assert.equal(result.a.eta, '2026-10-05T14:05:00.000Z');
  assert.equal(result.b.eta, '2026-10-05T14:38:00.000Z');
  assert.equal(result.c.eta, '2026-10-05T15:16:00.000Z');
  assert.equal(result.c.stopsAway, 2);
});

test('delivered stops are excluded and a delayed first leg pushes later stores', () => {
  const status = { a: { status: 'delivered' } };
  const normal = remainingStopEtas(meta, route, status, 600, 18 * 60, now);
  const traffic = remainingStopEtas(meta, route, status, 1200, 18 * 60, now);
  assert.equal(normal.b.stopsAway, 0);
  assert.equal(normal.a, undefined);
  assert.equal(Date.parse(traffic.c.eta) - Date.parse(normal.c.eta), 600000);
});
