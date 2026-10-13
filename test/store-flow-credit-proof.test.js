const test = require("node:test");
const assert = require("node:assert/strict");
const { verifiedStoreFlowCredit } = require("../store-flow-credit-proof");
const { POS_STORE_LOCATIONS } = require("../essentials-pos-conversion");

const cutover = Date.parse("2026-10-06T04:00:00Z");
function fixture(store) {
  const order = {
    id: "gid://shopify/Order/100", createdAt: "2026-10-06T05:00:00Z",
    displayFulfillmentStatus: "FULFILLED", tags: [POS_STORE_LOCATIONS[store]],
    customer: { tags: [] },
    fulfillments: [{ status: 'SUCCESS', location: { id: "gid://shopify/Location/40" } }],
    lineItems: { pageInfo: { hasNextPage: false }, nodes: [
      { id: "gid://shopify/LineItem/1", sku: "MEAL-1", quantity: 3,
        variant: { inventoryItem: { id: "gid://shopify/InventoryItem/20" } } },
    ] },
  };
  const group = {
    id: "gid://shopify/InventoryAdjustmentGroup/9", createdAt: "2026-10-06T05:01:00Z",
    reason: "correction", referenceDocumentUri: order.id, app: { id: "gid://shopify/App/7" },
    changes: [
      { name: "available", delta: 3, item: { id: "gid://shopify/InventoryItem/20" },
        location: { id: "gid://shopify/Location/30" } },
      { name: "on_hand", delta: 3, item: { id: "gid://shopify/InventoryItem/20" },
        location: { id: "gid://shopify/Location/30" } },
    ],
  };
  return { store, order, group, lineItemId: "gid://shopify/LineItem/1",
    locationId: "gid://shopify/Location/30", warehouseLocationId: "gid://shopify/Location/40",
    cutover, flowAppId: "gid://shopify/App/7" };
}

test("all 14 named Hummus Fit stores accept only their exact order-linked credit", () => {
  assert.equal(Object.keys(POS_STORE_LOCATIONS).length, 14);
  for (const store of Object.keys(POS_STORE_LOCATIONS)) {
    const proof = verifiedStoreFlowCredit(fixture(store));
    assert.equal(proof.store, store);
    assert.equal(proof.adjustmentId, "gid://shopify/InventoryAdjustmentGroup/9");
    assert.equal(proof.lines[0].quantity, 3);
  }
});

test("outside B2B, wrong store, order, app, item, quantity and warehouse fail closed", () => {
  const good = fixture("Ronkonkoma");
  assert.throws(() => verifiedStoreFlowCredit({ ...good, store: "Brookfield" }), /Exact Hummus Fit/);
  assert.throws(() => verifiedStoreFlowCredit({ ...good, store: "Holbrook" }), /exclusively/);
  assert.throws(() => verifiedStoreFlowCredit({ ...good,
    order: { ...good.order, tags: [POS_STORE_LOCATIONS.Ronkonkoma, POS_STORE_LOCATIONS.Holbrook] } }), /exclusively/);
  assert.throws(() => verifiedStoreFlowCredit({ ...good,
    group: { ...good.group, referenceDocumentUri: "gid://shopify/Order/999" } }), /order-linked/);
  assert.throws(() => verifiedStoreFlowCredit({ ...good, flowAppId: "gid://shopify/App/8" }), /order-linked/);
  assert.throws(() => verifiedStoreFlowCredit({ ...good,
    group: { ...good.group, changes: [{ ...good.group.changes[0], delta: 2 }] } }), /does not match/);
  assert.throws(() => verifiedStoreFlowCredit({ ...good,
    group: { ...good.group, changes: [{ ...good.group.changes[0], item: { id: "gid://shopify/InventoryItem/999" } }] } }), /does not match/);
  assert.throws(() => verifiedStoreFlowCredit({ ...good,
    order: { ...good.order, fulfillments: [{ location: { id: "gid://shopify/Location/999" } }] } }), /Shipping Warehouse/);
  assert.throws(() => verifiedStoreFlowCredit({ ...good,
    order: { ...good.order, createdAt: "2026-10-05T05:00:00Z" } }), /post-cutover/);
});

test("a SKU-less order line does not block another line's exact credit proof", () => {
  const good = fixture("Farmingdale");
  const unmapped = { id: "gid://shopify/LineItem/2", sku: null, quantity: 1,
    variant: { inventoryItem: { id: "gid://shopify/InventoryItem/21" } } };
  good.order.lineItems.nodes.push(unmapped);
  assert.equal(verifiedStoreFlowCredit(good).lines[0].sku, "MEAL-1");
  assert.equal(verifiedStoreFlowCredit({ ...good, lineItemId: unmapped.id }), null);
});
