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
const key = (item) => `${item.title}::${item.sku || ""}`;
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
  assert.equal(caseMapping({ ...dreamwich, sku: "SD-PEACH-60G-CS8" }).unitBarcode, "860014183430");
  const celsius = caseMapping({ ...coca, sku: "HF-NYB-CELSIUS-141-C12" });
  assert.deepEqual({ unitSku: celsius.unitSku, unitsPerCase: celsius.unitsPerCase,
    caseVariantId: celsius.caseVariantId, unitVariantId: celsius.unitVariantId,
    unitBarcode: celsius.unitBarcode }, {
    unitSku: "889392002379", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51259609678071",
    unitVariantId: "gid://shopify/ProductVariant/50500192633079",
    unitBarcode: "889392002379",
  });
  assert.equal(celsius.allowSharedProductMappingPendingTag, true);
  assert.match(caseMapping({ ...coca, sku: "HF-NYB-CELSIUS-140-C12" }).error, /mapping/);
  const moodz = caseMapping({ ...coca, sku: "MOODZ-STRAWBERRY-CS10" });
  assert.equal(moodz.unitSku, "MOODZ-STRAWBERRY-EA");
  assert.equal(moodz.unitsPerCase, 10);
  assert.equal(moodz.unitBarcode, "850075436248");
  assert.equal(moodz.requirePosSellUnitTag, true);
  assert.equal(caseMapping(supplies), null);
  assert.equal(caseMapping(food), null);
  assert.match(caseMapping({ ...coca, sku: "unmapped" }).error, /mapping/);
  assert.match(caseMapping({ ...coca, sku: "UNVERIFIED-CS8" }).error, /approved/);
});

test("East Islip's nine blocked cases have exact approved POS identities and pack sizes", () => {
  const expected = [
    ["HF-NYB-CELL-4909-C12", "842595141467", 12, "51259609546999", "51279794733303"],
    ["HF-NYB-CELSIUS-131-C12", "889392001563", 12, "51259609809143", "51279794667767"],
    ["HF-NYB-CELSIUS-1004-C12", "889392000320", 12, "51259609841911", "51279794700535"],
    ["HF-NYB-GHOST-1000-C12", "810169606339", 12, "51259609940215", "51280871325943"],
    ["MOODZ-BERRY-CS10", "850075436262", 10, "51284140753143", "51284140884215"],
    ["PS-075720000814-CS48", "075720000814", 48, "50514177261815", "50301570744567"],
    ["HF-NYB-QUEST3100-C8", "888849006649", 8, "51259610235127", "50344585953527"],
    ["HF-NYB-QUEST3104-C8", "888849011063", 8, "51259610267895", "50344586019063"],
    ["SD-PEACH-60G-CS8", "860014183430", 8, "51242444226807", "51259503444215"],
  ];
  for (const [sku, barcode, pack, caseId, unitId] of expected) {
    const line = caseMapping({ ...coca, sku });
    assert.equal(line.unitsPerCase, pack);
    assert.equal(line.unitBarcode, barcode);
    assert.equal(line.caseVariantId, `gid://shopify/ProductVariant/${caseId}`);
    assert.equal(line.unitVariantId, `gid://shopify/ProductVariant/${unitId}`);
    assert.equal(line.allowMissingBarcode, undefined);
  }
  assert.equal(caseMapping({ ...coca, sku: "HF-NYB-CELSIUS-140-C12" }).error.includes("mapping"), true);
});

test("Ronkonkoma's confirmed one-case receipts plan exact same-location case-to-unit exchanges", () => {
  const cases = [
    { sku: "HF-NYB-CELSIUS-141-C12", unitCost: 14, unitPrice: 3.50, unitAvailable: 4, units: 12 },
    { sku: "MOODZ-STRAWBERRY-CS10", unitCost: 29.90, unitPrice: 5.99, unitAvailable: 0, units: 10 },
  ];
  for (const item of cases) {
    const line = { ...caseMapping({ ...coca, sku: item.sku }), receivedCases: 1 };
    const plan = adjustmentPlan(line,
      { id: `case:${item.sku}`, available: 1, unitCost: item.unitCost },
      { id: `unit:${item.sku}`, available: item.unitAvailable, price: item.unitPrice },
      "ronkonkoma-pos-location", receiptKey("Ronkonkoma", "gid://shopify/Order/8068796645623", item.sku));
    assert.equal(plan.units, item.units);
    assert.deepEqual(plan.input.changes.map(({ locationId, delta }) => ({ locationId, delta })), [
      { locationId: "ronkonkoma-pos-location", delta: -1 },
      { locationId: "ronkonkoma-pos-location", delta: item.units },
    ]);
    if (item.sku === "HF-NYB-CELSIUS-141-C12") {
      assert.doesNotThrow(() => validateCaseAndUnit(line,
        { id: "case", available: 1, unitCost: 14, mappingPending: true },
        { id: "unit", available: 4, price: 3.50 }));
    }
  }
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

test("a SKU-less retail case reports its mapping gap without blocking an approved case", () => {
  const water = { title: "CASE — Poland Spring Water — 48 × 16.9 oz", sku: null, quantity: 1,
    productCollections: ["Retail Essentials"] };
  const order = { orderId: "gid://shopify/Order/2", lineItems: [coca, water] };
  const record = {
    orderId: order.orderId, completedAt: "2026-10-04T22:00:00Z",
    itemStatus: { [key(coca)]: "picked", [key(water)]: "picked" },
    itemScannedCount: { [key(coca)]: 3, [key(water)]: 1 },
  };
  const counts = { [coca.sku]: 3, [water.title]: 1 };
  const lines = receiptLines(order, record, counts, read);
  assert.equal(lines[0].unitSku, "4890008101306");
  assert.equal(lines[0].receivedCases, 3);
  assert.equal(lines[1].caseSku, water.title);
  assert.match(lines[1].error, /missing a Shopify SKU/);
  assert.throws(() => receiptLines(order, record, { ...counts, null: 1 }, read), /Unexpected receipt SKU/);
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
