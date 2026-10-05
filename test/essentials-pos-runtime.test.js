const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const conversion = require("../essentials-pos-conversion");

// Run the actual server conversion path with a fake Shopify transport and ledger.
// No network, warehouse writes, or production receipt replay.
function harness() {
  const source = fs.readFileSync(require.resolve("../server.js"), "utf8");
  const ledger = {};
  const quantities = { CASE: 2, UNIT: 3 };
  let writes = 0;
  const mapping = { caseSku: "CASE", unitSku: "UNIT", caseVariantId: "case-id",
    unitVariantId: "unit-id", unitsPerCase: 12, receivedCases: 2 };
  const context = vm.createContext({ ...conversion, posReceiptInFlight: new Set(),
    loadPosLedger: () => ledger,
    writePosLedgerEntry: (key, entry) => { ledger[key] = { ...ledger[key], ...entry }; },
    posShopifyGraphQL: async (query, variables) => {
      if (query.includes("query ExactSku")) {
        const sku = variables.search.slice(4);
        return { productVariants: { nodes: [{ id: sku === "CASE" ? "case-id" : "unit-id", sku,
          barcode: "123456789012", price: "4", product: { status: "ACTIVE", tags: [] },
          inventoryItem: { id: sku, unitCost: { amount: "24" },
            inventoryLevel: { quantities: [{ name: "available", quantity: quantities[sku] }] } } }] } };
      }
      assert.match(query, /inventoryAdjustQuantities/);
      assert.equal(variables.input.changes.length, 2);
      for (const change of variables.input.changes) {
        assert.equal(change.locationId, "store-id");
        assert.equal(change.changeFromQuantity, quantities[change.inventoryItemId]);
      }
      for (const change of variables.input.changes) quantities[change.inventoryItemId] += change.delta;
      writes++;
      return { inventoryAdjustQuantities: { inventoryAdjustmentGroup: { id: "adjustment-1" }, userErrors: [] } };
    },
  });
  vm.runInContext(source.slice(source.indexOf("async function exactInventoryItem("),
    source.indexOf("// Warehouse Finish Order now initiates conversion")), context);
  return { context, mapping, quantities, writes: () => writes };
}

test("actual conversion path swaps 2 cases for 24 units once, without warehouse writes", async () => {
  const h = harness();
  const first = await h.context.convertOneReceivedLine("Holbrook", "test-order", "store-id", h.mapping);
  assert.equal(first.status, "posted");
  assert.equal(first.units, 24);
  assert.deepEqual(h.quantities, { CASE: 0, UNIT: 27 });
  const repeated = await h.context.convertOneReceivedLine("Holbrook", "test-order", "store-id", h.mapping);
  assert.equal(repeated.status, "already_posted");
  assert.equal(h.writes(), 1);
});

test("actual conversion path blocks a mismatched mapping before any write", async () => {
  const h = harness();
  await assert.rejects(h.context.convertOneReceivedLine("Holbrook", "test-order", "store-id",
    { ...h.mapping, unitVariantId: "wrong-id" }), /approved Shopify variant/);
  assert.equal(h.writes(), 0);
  assert.deepEqual(h.quantities, { CASE: 2, UNIT: 3 });
});
