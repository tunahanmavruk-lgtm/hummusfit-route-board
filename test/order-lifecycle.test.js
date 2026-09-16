const assert = require("node:assert/strict");
const test = require("node:test");

const {
  b2bOrderExpiresAt,
  hasB2BSignal,
  nextB2BBoardCutoff,
  normalizeOrderTags,
  selectB2BStop,
} = require("../order-lifecycle.js");

const chooseStop = ({ orderTags = [], customerTags = [], zipCandidates = [], useZip = true }) =>
  selectB2BStop({
    orderTags,
    customerTags,
    zipCandidates,
    useZip,
    isEligible: (key) => ["brookfield", "fishkill", "ares", "pwrbld kop"].includes(key),
  });

test("routes Brookfield and Fishkill separately despite their shared ZIP", () => {
  const sharedZip = new Set(["brookfield", "fishkill"]);
  assert.equal(chooseStop({ customerTags: ["brookfield", "wholesale"], zipCandidates: sharedZip }), "brookfield");
  assert.equal(chooseStop({ customerTags: ["fishkill", "wholesale"], zipCandidates: sharedZip }), "fishkill");
  assert.equal(chooseStop({ orderTags: ["brookfield"], customerTags: ["fishkill"], zipCandidates: sharedZip }), "brookfield");
});

test("never guesses or duplicates a shared-address order with ambiguous tags", () => {
  const sharedZip = new Set(["brookfield", "fishkill"]);
  assert.equal(chooseStop({ zipCandidates: sharedZip }), null);
  assert.equal(chooseStop({ customerTags: ["brookfield", "fishkill"], zipCandidates: sharedZip }), null);
  assert.equal(chooseStop({ orderTags: ["brookfield", "fishkill"], zipCandidates: sharedZip }), null);
});

test("unique destination ZIP beats stale shared-account customer tags", () => {
  assert.equal(chooseStop({ customerTags: ["ares"], zipCandidates: new Set(["pwrbld kop"]) }), "pwrbld kop");
});

test("an expired stop does not make a shared ZIP look unique", () => {
  assert.equal(selectB2BStop({
    orderTags: [], customerTags: [], zipCandidates: new Set(["brookfield", "fishkill"]),
    useZip: true, isEligible: (key) => key === "fishkill",
  }), null);
});

test("expires a B2B order at 8 PM ET on its next scheduled delivery day", () => {
  // Saturday order for a Monday/Thursday stop belongs to Monday's route.
  const expiry = nextB2BBoardCutoff("2026-09-05T16:00:00.000Z", [1, 4]);
  assert.equal(new Date(expiry).toISOString(), "2026-09-08T00:00:00.000Z");
});

test("keeps a late scan through the next valid delivery instead of dropping it", () => {
  // If a Thursday-only order is scanned after Thursday's cutoff, retain the
  // completed snapshot through the following Thursday's delivery cutoff.
  const expiry = b2bOrderExpiresAt(
    "2026-09-09T14:00:00.000Z",
    [4],
    "2026-09-11T01:00:00.000Z"
  );
  assert.equal(new Date(expiry).toISOString(), "2026-09-18T00:00:00.000Z");
});

test("requires a wholesale/B2B signal before using a destination ZIP fallback", () => {
  const regularCustomerTags = normalizeOrderTags({
    tags: ["in_transit_notified", "UPS Ground Shipping"],
    customer: { tags: ["Tier 4"] },
  });
  assert.equal(hasB2BSignal(regularCustomerTags), false, "#687037 must not map to Nourish'd by ZIP");
  assert.equal(hasB2BSignal(["wholesale"]), true);
  assert.equal(hasB2BSignal(["B2B"]), true);
});

test("the reported old completed batches are past their route cutoff", () => {
  const now = new Date("2026-09-09T16:00:00.000Z").getTime();
  const batches = [
    { orders: ["#692079", "#692148"], createdAt: "2026-09-05T16:00:00.000Z", days: [1, 4] },
    { orders: ["#685088", "#686095"], createdAt: "2026-09-01T16:00:00.000Z", days: [2, 5] },
    { orders: ["#685061", "#685118", "#686023", "#687037"], createdAt: "2026-09-01T16:00:00.000Z", days: [2, 4] },
    { orders: ["#685347", "#685363", "#685973"], createdAt: "2026-09-01T16:00:00.000Z", days: [2, 5] },
    { orders: ["#685909"], createdAt: "2026-09-01T16:00:00.000Z", days: [2, 5] },
  ];
  batches.forEach((batch) => {
    assert.ok(
      b2bOrderExpiresAt(batch.createdAt, batch.days) < now,
      `${batch.orders.join(", ")} should be expired`
    );
  });
});
