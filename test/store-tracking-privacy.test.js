const assert = require('node:assert/strict');
const test = require('node:test');
const {
  routeHasStarted, routeHasEtaPlan, knownDestination, censusDestination,
  firstTripEndNearStore, trackingCutoffAt,
} = require('../store-tracking-privacy.js');

const started = '2026-10-05T12:00:00Z';
const store = { lat: 40.0, lon: -73.0 };
const trip = (endTime, lon, lat) => ({ endTime, gps: { type: 'LineString', coordinates: [[-73.1, 40.1], [lon, lat]] } });

test('a recorded start remains started when Google route optimization fails', () => {
  const startOnly = { startedAt: started };
  assert.equal(routeHasStarted(startOnly), true);
  assert.equal(routeHasEtaPlan(startOnly), false);
  assert.equal(routeHasStarted({}), false);
  assert.equal(routeHasEtaPlan({ ...startOnly, optimizedStopIds: ['s1'], legDurationsSeconds: [90, 100] }), true);
});

test('Census coordinates require one address match in the requested ZIP', () => {
  const address = '540 Federal Rd Unit 2B, Brookfield, CT 06804';
  const match = { coordinates: { x: -73.409292, y: 41.463492 }, addressComponents: { zip: '06804' } };
  assert.deepEqual(censusDestination({ result: { addressMatches: [match] } }, address), { lat: 41.463492, lon: -73.409292 });
  assert.equal(censusDestination({ result: { addressMatches: [] } }, address), null);
  assert.equal(censusDestination({ result: { addressMatches: [match, match] } }, address), null);
  assert.equal(censusDestination({ result: { addressMatches: [{ ...match, addressComponents: { zip: '06805' } }] } }, address), null);
});

test('known delivery points remain available when address geocoding cannot match them', () => {
  assert.deepEqual(knownDestination('297 Boston Post Rd #14, Orange, CT 06477'), {
    lat: 41.2665186, lon: -73.00268009,
  });
  assert.deepEqual(knownDestination('200 Ronkonkoma Ave, Ronkonkoma, NY'), {
    lat: 40.8206952, lon: -73.113406799,
  });
  assert.equal(knownDestination('Unknown stop'), null);
});

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
