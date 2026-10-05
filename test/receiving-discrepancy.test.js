const test = require("node:test");
const assert = require("node:assert/strict");
const { retailShortagePlan, shortageKey } = require("../receiving-discrepancy");

const input = {
  store: "Holbrook", orderId: "gid://shopify/Order/123", reportId: "Holbrook::1",
  line: { caseSku: "CASE-8", unitSku: "UNIT", unitsPerCase: 8, pickedCases: 2, receivedCases: 1 },
  postedConversion: { status: "posted", units: 16,
    adjustmentId: "gid://shopify/InventoryAdjustmentGroup/200" },
  unitItem: { id: "gid://shopify/InventoryItem/300", available: 20 },
  locationId: "gid://shopify/Location/400",
};

test("a verified missing case reverses eight sell-units at the exact store", () => {
  const plan = retailShortagePlan(input);
  assert.equal(plan.delta, -8);
  assert.equal(plan.input.changes.length, 1);
  assert.equal(plan.input.changes[0].inventoryItemId, input.unitItem.id);
  assert.equal(plan.input.changes[0].locationId, input.locationId);
  assert.equal(plan.input.changes[0].changeFromQuantity, 20);
  assert.match(plan.input.referenceDocumentUri, /agent-hazar-receiving/);
  assert.equal(plan.key, shortageKey(input.store, input.orderId, input.line.caseSku));
});

test("a case conversion that posted only received units cannot be reversed again", () => {
  assert.throws(() => retailShortagePlan({ ...input, postedConversion: {
    ...input.postedConversion, units: 8,
  } }), /original POS case conversion is not confirmed/);
});

test("unknown mapping, extra counts, unconfirmed conversion, and insufficient stock are blocked", () => {
  assert.throws(() => retailShortagePlan({ ...input, line: { ...input.line, unitSku: "" } }), /verified retail/);
  assert.throws(() => retailShortagePlan({ ...input, line: { ...input.line, receivedCases: 3 } }), /verified retail/);
  assert.throws(() => retailShortagePlan({ ...input, postedConversion: null }), /not confirmed/);
  assert.throws(() => retailShortagePlan({ ...input, unitItem: { ...input.unitItem, available: 7 } }), /cannot safely cover/);
});
