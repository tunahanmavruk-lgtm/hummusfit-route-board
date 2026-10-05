const assert = require('node:assert/strict');
const test = require('node:test');
const { firstTripEndNearStore, trackingCutoffAt } = require('../store-tracking-privacy.js');

const started = '2026-10-05T12:00:00Z';
const store = { lat: 40.0, lon: -73.0 };
const trip = (endTime, lon, lat) => ({ endTime, gps: { type: 'LineString', coordinates: [[-73.1, 40.1], [lon, lat]] } });

test('a completed trip ending at this store closes its map ten minutes later', () => {
  const ended = firstTripEndNearStore([
    trip('2026-10-05T11:30:00Z', -73, 40), // prior trip is irrelevant
    trip('2026-10-05T12:10:00Z', -73.01, 40.01), // another destination
    trip('2026-10-05T12:20:00Z', -73.0001, 40.0001),
  ], store, started);
  assert.equal(ended, Date.parse('2026-10-05T12:20:00Z'));
  assert.equal(trackingCutoffAt(started, {}, ended), Date.parse('2026-10-05T12:30:00Z'));
});

test('the first store visit remains the cutoff even if the van returns', () => {
  const ended = firstTripEndNearStore([
    trip('2026-10-05T12:20:00Z', -73, 40),
    trip('2026-10-05T14:00:00Z', -73, 40),
  ], store, started);
  assert.equal(ended, Date.parse('2026-10-05T12:20:00Z'));
});

test('driver delivery closes tracking immediately; arrival and route age are also bounded', () => {
  assert.equal(trackingCutoffAt(started, { status: 'delivered', deliveredAt: '2026-10-05T12:05:00Z' }), Date.parse('2026-10-05T12:05:00Z'));
  assert.equal(trackingCutoffAt(started, { status: 'delivered' }), 0);
  assert.equal(trackingCutoffAt(started, { status: 'arrived', arrivedAt: '2026-10-05T12:10:00Z' }), Date.parse('2026-10-05T12:10:20Z'));
  assert.equal(trackingCutoffAt(started), Date.parse('2026-10-06T04:00:00Z'));
});
