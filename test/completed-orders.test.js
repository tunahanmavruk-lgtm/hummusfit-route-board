const assert = require("node:assert/strict");
const test = require("node:test");
const { mergeRecentCompletedOrders } = require("../order-lifecycle.js");

const now = Date.parse("2026-10-01T16:00:00Z");
const validStops = new Map([["meriden", {}], ["islip", {}]]);
const completed = {
  orderId: "gid://shopify/Order/123",
  orderName: "#123",
  completedAt: "2026-09-30T20:00:00Z",
  archivedAt: "2026-09-30T20:00:00Z",
  shopifyFulfilled: true,
  lineItems: [{ title: "Buffalo Mac", quantity: 2 }],
  closedCrates: [1],
};

test("restores a picked Shopify-fulfilled stop without changing live orders", () => {
  const live = { islip: { orderId: "live-1", orderName: "#456" } };
  const merged = mergeRecentCompletedOrders(live, { meriden: completed }, validStops, now);
  assert.deepEqual(merged.islip, live.islip);
  assert.equal(merged.meriden.orderName, "#123");
  assert.equal(merged.meriden.retainedAfterFulfillment, true);
  assert.deepEqual(merged.meriden.lineItems, completed.lineItems);
  assert.deepEqual(live, { islip: { orderId: "live-1", orderName: "#456" } });
});

test("a newer live order takes precedence over an archived pick", () => {
  const live = { meriden: { orderId: "new-order", orderName: "#789" } };
  assert.equal(mergeRecentCompletedOrders(live, { meriden: completed }, validStops, now).meriden.orderId, "new-order");
});

test("delivered, incomplete, invalid, and expired snapshots stay off the board", () => {
  const variants = [
    { ...completed, deliveryComplete: true },
    { ...completed, completedAt: null },
    { ...completed, shopifyFulfilled: false },
    { ...completed, archivedAt: "2026-09-20T20:00:00Z" },
  ];
  for (const candidate of variants) {
    assert.deepEqual(mergeRecentCompletedOrders({}, { meriden: candidate }, validStops, now), {});
  }
  assert.deepEqual(mergeRecentCompletedOrders({}, { unknown: completed }, validStops, now), {});
});
