const assert = require("node:assert/strict");
const test = require("node:test");

const {
  hasB2BSignal,
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

test("never makes a shared ZIP look unique when only one stop is eligible", () => {
  assert.equal(selectB2BStop({
    orderTags: [], customerTags: [], zipCandidates: new Set(["brookfield", "fishkill"]),
    useZip: true, isEligible: (key) => key === "fishkill",
  }), null);
});

test("routes an explicitly tagged Yorktown order without an age cutoff", () => {
  const stop = selectB2BStop({
    orderTags: ["yorktown"],
    customerTags: [],
    zipCandidates: [],
    useZip: false,
    isEligible: (key) => key === "yorktown",
  });
  assert.equal(stop, "yorktown");
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
