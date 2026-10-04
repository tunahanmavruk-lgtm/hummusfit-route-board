const test = require("node:test");
const assert = require("node:assert/strict");
const { caseMapping, receiptLines, receiptKey, validateCaseAndUnit, adjustmentPlan, POS_STORE_LOCATIONS } = require("../essentials-pos-conversion");

const coca = {
  title: "Coca-Cola Plus Japan 8-pack", sku: "SS-4890008101306-CS8", quantity: 3,
  productCollections: ["Retail Essentials"],
};
const dreamwich = {
  title: "BUILT Dreamwich 12-count case", sku: "BUILT-PFB0374-CS12", quantity: 2,
  productCollections: ["Retail Essentials"],
};
const supplies = {
  title: "Store paper supplies", sku: "PAPER-CS24", quantity: 1,
  productCollections: ["Other Essentials"],
};
const food = { title: "Chicken meal", sku: "MEAL-001", quantity: 4 };
const key = (item) => `${item.title}::${item.sku}`;
const read = (dict, item, index) => dict?.[key(item)] ?? dict?.[index];

test("maps a Retail Essentials case to its exact sell-unit SKU and quantity", () => {
  assert.equal(caseMapping(coca).unitSku, "4890008101306");
  assert.equal(caseMapping(coca).unitsPerCase, 8);
  assert.equal(caseMapping(coca).unitBarcode, "4890008101306");
  assert.equal(caseMapping(coca).unitVariantId, "gid://shopify/ProductVariant/51028267499767");
  assert.equal(caseMapping(coca).allowMissingBarcode, undefined);
  assert.equal(caseMapping(dreamwich).unitsPerCase, 12);
  assert.equal(caseMapping(dreamwich).allowMissingBarcode, true);
  assert.equal(caseMapping(dreamwich).requirePosSellUnitTag, true);
  assert.equal(caseMapping({ ...dreamwich, sku: "SS-8806002023472-CS24" }).allowMissingBarcode, true);
  assert.equal(caseMapping({ ...dreamwich, sku: "SD-PEACH-60G-CS8" }).allowMissingBarcode, true);
  assert.equal(caseMapping(supplies), null);
  assert.equal(caseMapping(food), null);
  assert.match(caseMapping({ ...coca, sku: "unmapped" }).error, /mapping/);
  assert.match(caseMapping({ ...coca, sku: "UNVERIFIED-CS8" }).error, /approved/);
});

test("uses separate Essentials pick state and excludes food and Other Essentials", () => {
  const order = { orderId: "gid://shopify/Order/1", lineItems: [food, coca, supplies, dreamwich] };
  const record = {
    orderId: order.orderId, completedAt: "2026-10-04T12:00:00Z",
    itemStatus: { [key(coca)]: "picked", [key(supplies)]: "picked", [key(dreamwich)]: "picked" },
    itemScannedCount: { [key(coca)]: 3, [key(supplies)]: 1, [key(dreamwich)]: 2 },
  };
  const result = receiptLines(order, record, {
    "SS-4890008101306-CS8": 3, "BUILT-PFB0374-CS12": 2,
  }, read);
  assert.equal(result.length, 2);
  assert.equal(result[0].receivedCases * result[0].unitsPerCase, 24);
  assert.equal(result[1].receivedCases * result[1].unitsPerCase, 24);
  assert.throws(() => receiptLines(order, record, { "SS-4890008101306-CS8": 4, "BUILT-PFB0374-CS12": 2 }, read), /Invalid received/);
  assert.throws(() => receiptLines(order, record, { "SS-4890008101306-CS8": 3, "BUILT-PFB0374-CS12": 2, "PAPER-CS24": 1 }, read), /Unexpected/);
  assert.throws(() => receiptLines(order, { ...record, orderId: "wrong" }, { "SS-4890008101306-CS8": 3 }, read), /exact order/);
});

test("idempotency key is stable per store, order, and case SKU", () => {
  const a = receiptKey("Holbrook", "order-1", coca.sku);
  assert.equal(a, receiptKey("Holbrook", "order-1", coca.sku));
  assert.notEqual(a, receiptKey("Islip", "order-1", coca.sku));
  assert.notEqual(a, receiptKey("Holbrook", "order-2", coca.sku));
});

test("only the 14 active Hummus Fit store POS locations can receive sell units", () => {
  assert.equal(Object.keys(POS_STORE_LOCATIONS).length, 14);
  assert.equal(POS_STORE_LOCATIONS.Islip, "Hummus Fit East Islip");
  assert.equal(POS_STORE_LOCATIONS.Holbrook, "Hummus Fit Holbrook");
  assert.equal(POS_STORE_LOCATIONS.Brookfield, undefined);
  assert.equal(POS_STORE_LOCATIONS.Fishkill, undefined);
  assert.equal(POS_STORE_LOCATIONS["Shipping Warehouse"], undefined);
});

test("one adjustment atomically removes cases and adds units at the same POS location with CAS", () => {
  const line = { ...caseMapping(coca), receivedCases: 3 };
  const plan = adjustmentPlan(line, { id: "case-item", available: 3, unitCost: 14.8 }, { id: "unit-item", available: 5, price: 3.25 }, "holbrook-location", "receipt-key");
  assert.equal(plan.units, 24);
  assert.equal(plan.input.name, "available");
  assert.deepEqual(plan.input.changes, [
    { inventoryItemId: "case-item", locationId: "holbrook-location", delta: -3, changeFromQuantity: 3 },
    { inventoryItemId: "unit-item", locationId: "holbrook-location", delta: 24, changeFromQuantity: 5 },
  ]);
  assert.throws(() => adjustmentPlan(line, { id: "case-item", available: 2, unitCost: 14.8 }, { id: "unit-item", available: 0, price: 3.25 }, "holbrook-location", "receipt-key"), /not arrived/);
  assert.throws(() => adjustmentPlan(line, { id: "case-item", available: 3, unitCost: 44.4 }, { id: "unit-item", available: 0, price: 3.25 }, "holbrook-location", "receipt-key"), /case-derived unit cost/);
  assert.throws(() => adjustmentPlan(line, { id: "case-item", available: 3, unitCost: 14.8, mappingPending: true }, { id: "unit-item", available: 0, price: 3.25 }, "holbrook-location", "receipt-key"), /mapping is still pending/);
});

test("an inactive sell-unit location can be validated before zero-stock activation, but not adjusted", () => {
  const line = { ...caseMapping(coca), receivedCases: 1 };
  const caseItem = { id: "case-item", available: 1, unitCost: 14.8 };
  const inactiveUnit = { id: "unit-item", available: null, price: 3.25 };
  assert.doesNotThrow(() => validateCaseAndUnit(line, caseItem, inactiveUnit));
  assert.throws(() => adjustmentPlan(line, caseItem, inactiveUnit, "holbrook-location", "receipt-key"), /not active/);
  assert.throws(() => validateCaseAndUnit(line, { ...caseItem, mappingPending: true }, inactiveUnit), /mapping is still pending/);
  assert.throws(() => validateCaseAndUnit(line, { ...caseItem, unitCost: 44.4 }, inactiveUnit), /case-derived unit cost/);
});
