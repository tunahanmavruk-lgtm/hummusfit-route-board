const assert = require('node:assert/strict');
const test = require('node:test');
const { mergeRecentCompletedOrders, boardOrdersByStop } = require('../order-lifecycle.js');

const validStops = new Map([
  ['meriden', { isB2B: true, deliveryDays: [4] }],
  ['islip', { isB2B: false, deliveryDays: null }],
]);
const completed = {
  orderId: 'gid://shopify/Order/123',
  orderName: '#123',
  completedAt: '2026-10-01T14:00:00Z',
  archivedAt: '2026-10-01T14:00:00Z',
  fulfilledAt: '2026-10-01T16:00:00Z', // Thursday noon EDT
  shopifyFulfilled: true,
  lineItems: [{ title: 'Buffalo Mac', quantity: 2 }],
};
const visibleAt = Date.parse('2026-10-02T16:59:59Z'); // Friday 12:59:59 PM EDT
const expiredAt = Date.parse('2026-10-02T17:00:00Z'); // Friday 1 PM EDT

test('fulfilled order stays on board through next-day 12:59:59 PM Eastern, including after delivery', () => {
  const saved = { ...completed, deliveryComplete: true, deliveredAt: '2026-10-01T21:00:00Z' };
  const merged = mergeRecentCompletedOrders({}, { meriden: saved }, validStops, visibleAt);
  assert.equal(merged.meriden.orderId, completed.orderId);
  assert.equal(merged.meriden.deliveryComplete, true);
  assert.equal(merged.meriden.retainedAfterFulfillment, true);
  assert.deepEqual(merged.meriden.lineItems, completed.lineItems);
  assert.deepEqual(mergeRecentCompletedOrders({}, { meriden: saved }, validStops, expiredAt), {});
});

test('unfulfilled live order stays visible after cutoff and beats old archive', () => {
  const live = { meriden: { orderId: 'new-unfulfilled', orderName: '#new' } };
  assert.equal(mergeRecentCompletedOrders(live, { meriden: completed }, validStops, expiredAt).meriden.orderId, 'new-unfulfilled');
  assert.deepEqual(mergeRecentCompletedOrders(live, {}, validStops, expiredAt), live);
});

test('actual fulfillment day controls cutoff, not picking or scheduled delivery day', () => {
  const pickedFridayFulfilledMonday = {
    ...completed,
    completedAt: '2026-10-02T21:00:00Z',
    archivedAt: '2026-10-02T21:00:00Z',
    fulfilledAt: '2026-10-05T15:00:00Z',
  };
  const brookfield = new Map([['brookfield', { isB2B: true, deliveryDays: [1] }]]);
  const archive = { brookfield: pickedFridayFulfilledMonday };
  assert.ok(mergeRecentCompletedOrders({}, archive, brookfield, Date.parse('2026-10-06T16:59:00Z')).brookfield);
  assert.deepEqual(mergeRecentCompletedOrders({}, archive, brookfield, Date.parse('2026-10-06T17:00:00Z')), {});
});

test('cutoff follows Eastern local day across fall daylight-saving change', () => {
  const archive = { islip: { ...completed, fulfilledAt: '2026-10-31T20:00:00Z' } };
  assert.ok(mergeRecentCompletedOrders({}, archive, validStops, Date.parse('2026-11-01T17:59:59Z')).islip);
  assert.deepEqual(mergeRecentCompletedOrders({}, archive, validStops, Date.parse('2026-11-01T18:00:00Z')), {});
});

test('incomplete and invalid snapshots do not appear', () => {
  for (const saved of [
    { ...completed, completedAt: null },
    { ...completed, shopifyFulfilled: false },
    { ...completed, fulfilledAt: '2026-10-03T12:00:00Z' },
  ]) {
    assert.deepEqual(mergeRecentCompletedOrders({}, { meriden: saved }, validStops, visibleAt), {});
  }
  assert.deepEqual(mergeRecentCompletedOrders({}, { unknown: completed }, validStops, visibleAt), {});
});

test('route board clears prior-day local orders at 1 PM Eastern, even if Shopify still calls them unfulfilled', () => {
  const live = { islip: {
    orderId: 'old', orderName: '#old', createdAt: '2026-10-04T20:00:00Z',
    orders: [{ id: 'old', name: '#old', createdAt: '2026-10-04T20:00:00Z' }],
    lineItems: [{ title: 'Meal', quantity: 1 }],
  } };
  assert.ok(boardOrdersByStop(live, validStops, Date.parse('2026-10-05T16:59:59Z')).islip);
  assert.deepEqual(boardOrdersByStop(live, validStops, Date.parse('2026-10-05T17:00:00Z')), {});
  assert.equal(live.islip.orderId, 'old'); // original picking feed remains available
});

test('new same-stop order remains on board when an old one expires', () => {
  const oldOrder = { id: 'old', name: '#old', createdAt: '2026-10-04T20:00:00Z' };
  const newOrder = { id: 'new', name: '#new', createdAt: '2026-10-05T20:00:00Z' };
  const live = { islip: { orderId: 'old,new', orderName: '#old, #new',
    createdAt: oldOrder.createdAt, orders: [oldOrder, newOrder] } };
  const board = boardOrdersByStop(live, validStops, Date.parse('2026-10-05T21:00:00Z'));
  assert.equal(board.islip.orderId, 'new');
  assert.equal(board.islip.orderName, '#new');
  assert.equal(board.islip.orderCount, 1);
  assert.equal(live.islip.orderName, '#old, #new');
});

test('B2B order placed days ahead remains until 1 PM on its next scheduled delivery day', () => {
  const stops = new Map([['brookfield', { isB2B: true, deliveryDays: [1] }]]);
  const order = { brookfield: { orderId: 'b2b', orderName: '#b2b',
    createdAt: '2026-09-30T19:00:00Z' } };
  assert.ok(boardOrdersByStop(order, stops, Date.parse('2026-10-05T16:59:59Z')).brookfield);
  assert.deepEqual(boardOrdersByStop(order, stops, Date.parse('2026-10-05T17:00:00Z')), {});
});

test('route board cutoff follows Eastern daylight saving time', () => {
  const order = { islip: { orderId: 'dst', orderName: '#dst', createdAt: '2026-10-31T20:00:00Z' } };
  assert.ok(boardOrdersByStop(order, validStops, Date.parse('2026-11-01T17:59:59Z')).islip);
  assert.deepEqual(boardOrdersByStop(order, validStops, Date.parse('2026-11-01T18:00:00Z')), {});
});
