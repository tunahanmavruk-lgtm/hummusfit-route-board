const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const conversion = require('../essentials-pos-conversion');

const caseSku = 'GLOBAL GT628007-CS6';
const line = { ...conversion.caseMapping({ sku: caseSku, productTags: ['retail-essentials'] }), receivedCases: 2 };

// Exercise the real server functions with an isolated ledger and Shopify fake.
// Never replay a production receipt or adjust real inventory in these tests.
function harness({ changeVariant, loseResponse = false } = {}) {
  const ledger = {};
  const quantities = { CASE: 2, UNIT: 0 };
  const mutations = [];
  const shopifyKeys = new Map();
  let writes = 0;
  const context = vm.createContext({ ...conversion, posReceiptInFlight: new Set(),
    loadPosLedger: () => ledger,
    writePosLedgerEntry: (key, entry) => { ledger[key] = { ...ledger[key], ...entry }; },
    posShopifyGraphQL: async (query, variables) => {
      if (query.includes('query ExactMappedVariant')) {
        const isCase = variables.id === line.caseVariantId;
        const kind = isCase ? 'CASE' : 'UNIT';
        const variant = { id: variables.id, sku: isCase ? caseSku : line.unitSku,
          barcode: isCase ? null : line.unitBarcode, price: isCase ? '0' : '3.99',
          product: { status: 'ACTIVE', tags: isCase ? ['mapping-pending'] : ['pos-sell-unit'] },
          inventoryItem: { id: kind, duplicateSkuCount: 0, unitCost: { amount: isCase ? '9.97' : '2.49' },
            inventoryLevel: { quantities: [{ name: 'available', quantity: quantities[kind] }] } } };
        if (changeVariant) changeVariant(variant, isCase);
        return { productVariant: variant };
      }
      assert.match(query, /inventoryAdjustQuantities/);
      assert.match(query, /@idempotent\(key: \$key\)/);
      mutations.push(variables);
      if (shopifyKeys.has(variables.key)) return shopifyKeys.get(variables.key);
      for (const change of variables.input.changes) {
        assert.equal(change.changeFromQuantity, quantities[change.inventoryItemId]);
        quantities[change.inventoryItemId] += change.delta;
      }
      writes++;
      const response = { inventoryAdjustQuantities: { inventoryAdjustmentGroup: { id: 'proof-1' }, userErrors: [] } };
      shopifyKeys.set(variables.key, response);
      if (loseResponse) { loseResponse = false; throw new Error('Response lost after Shopify committed'); }
      return response;
    },
  });
  const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('async function exactInventoryItem('), source.indexOf('// In-memory cache, refreshed on demand')), context);
  return { context, quantities, mutations, ledger, writes: () => writes };
}

test('verified Dr Pepper pair is exact; pending cans and non-retail items stay blocked', () => {
  assert.equal(line.unitSku, 'SS-8801094000455');
  assert.equal(line.unitBarcode, '8801094000455');
  assert.equal(line.unitsPerCase, 6);
  assert.equal(line.caseVariantId, 'gid://shopify/ProductVariant/51304197357815');
  assert.equal(line.unitVariantId, 'gid://shopify/ProductVariant/51259495874807');
  assert.equal(line.allowMissingBarcode, undefined);
  for (const sku of ['GLOBAL GT628021-CS24', 'GLOBAL GT628019-CS6', 'Global GT628008-CS24', 'GLOBAL GT628004-CS6']) {
    assert.match(conversion.caseMapping({ sku, productTags: ['retail-essentials'] }).error, /approved/);
  }
  assert.equal(conversion.caseMapping({ sku: caseSku }), null);
  assert.equal(conversion.caseMapping({ sku: caseSku, productCollections: ['Other Essentials'] }), null);
});

test('all 14 destinations exchange 2 verified cases for 12 units exactly once', async () => {
  assert.equal(Object.keys(conversion.POS_STORE_LOCATIONS).length, 14);
  for (const store of Object.keys(conversion.POS_STORE_LOCATIONS)) {
    const h = harness();
    const first = await h.context.convertOneReceivedLine(store, 'test-order', store, line);
    assert.equal(first.status, 'posted');
    assert.equal(first.units, 12);
    assert.deepEqual(h.quantities, { CASE: 0, UNIT: 12 });
    for (const change of h.mutations[0].input.changes) assert.equal(change.locationId, store);
    const retry = await h.context.convertOneReceivedLine(store, 'test-order', store, line);
    assert.equal(retry.status, 'already_posted');
    assert.equal(retry.adjustmentId, 'proof-1');
    assert.equal(h.writes(), 1);
  }
});

test('lost response reuses persisted plan and Shopify key without a duplicate increase', async () => {
  const h = harness({ loseResponse: true });
  await assert.rejects(h.context.convertOneReceivedLine('Holbrook', 'test-order', 'store', line), /Response lost/);
  assert.equal(h.writes(), 1);
  const result = await h.context.convertOneReceivedLine('Holbrook', 'test-order', 'store', line);
  assert.equal(result.status, 'posted');
  assert.equal(h.writes(), 1);
  assert.equal(h.mutations[0].key, h.mutations[1].key);
  assert.deepEqual(h.mutations[0].input, h.mutations[1].input);
});

test('wrong ID, changed SKU, duplicate SKU, wrong barcode and inactive units fail before writes', async () => {
  const changes = [
    v => { v.id = 'gid://shopify/ProductVariant/1'; },
    v => { v.sku += '-changed'; },
    v => { v.inventoryItem.duplicateSkuCount = 1; },
    (v, isCase) => { if (!isCase) v.barcode = '8801094000000'; },
    (v, isCase) => { if (!isCase) v.product.status = 'DRAFT'; },
    (v, isCase) => { if (!isCase) v.product.tags = []; },
    (v, isCase) => { if (isCase) v.inventoryItem.inventoryLevel.quantities[0].quantity = 0; },
  ];
  for (const changeVariant of changes) {
    const h = harness({ changeVariant });
    await assert.rejects(h.context.convertOneReceivedLine('Holbrook', 'test-order', 'store', line));
    assert.equal(h.writes(), 0);
  }
});

test('unapproved spaced SKU still fails, and zero receipt never writes', async () => {
  const h = harness();
  await assert.rejects(h.context.exactInventoryItem(caseSku, 'store'), /not safe/);
  assert.equal((await h.context.convertOneReceivedLine('Holbrook', 'test-order', 'store', { ...line, receivedCases: 0 })).status, 'zero_received');
  assert.equal(h.writes(), 0);
});
