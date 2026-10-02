const assert = require("node:assert/strict");
const test = require("node:test");
const { mergeRecentCompletedOrders } = require("../order-lifecycle.js");

const now = Date.parse("2026-10-01T16:00:00Z");
const validStops = new Map([
  ["meriden", { isB2B: true, deliveryDays: [4] }],
  ["islip", { isB2B: false, deliveryDays: null }],
]);
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

test("Thursday route picked Wednesday remains visible until Friday 3 PM Eastern", () => {
  const before = Date.parse("2026-10-02T18:59:00Z"); // Friday 2:59 PM ET
  const after = Date.parse("2026-10-02T19:00:00Z"); // Friday 3:00 PM ET
  assert.ok(mergeRecentCompletedOrders({}, { meriden: completed }, validStops, before).meriden);
  assert.deepEqual(mergeRecentCompletedOrders({}, { meriden: completed }, validStops, after), {});
});

test("yesterday's Wednesday route clears Thursday at 3 PM without hiding today's live order", () => {
  const metadata = new Map([["new castle", { isB2B: true, deliveryDays: [3] }]]);
  const archive = { "new castle": { ...completed, archivedAt: "2026-09-29T17:00:00Z" } };
  const after = Date.parse("2026-10-01T19:00:00Z");
  assert.deepEqual(mergeRecentCompletedOrders({}, archive, metadata, after), {});
  const live = { "new castle": { orderId: "new-unfulfilled", orderName: "#new" } };
  assert.equal(mergeRecentCompletedOrders(live, archive, metadata, after)["new castle"].orderId, "new-unfulfilled");
});

test("Friday picking for Monday delivery survives the weekend and clears Tuesday afternoon", () => {
  const metadata = new Map([["brookfield", { isB2B: true, deliveryDays: [1] }]]);
  const archive = { brookfield: { ...completed, archivedAt: "2026-10-02T21:00:00Z" } }; // Friday 5 PM ET
  assert.ok(mergeRecentCompletedOrders({}, archive, metadata, Date.parse("2026-10-06T18:59:00Z")).brookfield);
  assert.deepEqual(mergeRecentCompletedOrders({}, archive, metadata, Date.parse("2026-10-06T19:00:00Z")), {});
});

test("local orders picked after noon stay through the next day's route", () => {
  const archive = { islip: { ...completed, archivedAt: "2026-10-01T20:00:00Z" } }; // Thursday 4 PM ET
  assert.ok(mergeRecentCompletedOrders({}, archive, validStops, Date.parse("2026-10-03T18:59:00Z")).islip);
  assert.deepEqual(mergeRecentCompletedOrders({}, archive, validStops, Date.parse("2026-10-03T19:00:00Z")), {});
});

test("3 PM Eastern cleanup remains correct across daylight-saving changes", () => {
  const archive = { islip: { ...completed, archivedAt: "2026-10-31T20:00:00Z" } }; // Saturday 4 PM EDT
  assert.ok(mergeRecentCompletedOrders({}, archive, validStops, Date.parse("2026-11-02T19:59:00Z")).islip);
  assert.deepEqual(mergeRecentCompletedOrders({}, archive, validStops, Date.parse("2026-11-02T20:00:00Z")), {});
});
