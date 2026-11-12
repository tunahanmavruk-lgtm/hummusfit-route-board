const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const path = require('node:path');
const conversion = require('../essentials-pos-conversion');

const caseSku = 'HF-NYB-RAW-322-C12';
const line = { ...conversion.caseMapping({ sku: caseSku, productTags: ['retail-essentials'] }), receivedCases: 1 };

function harness({ archivedStatus = 'ARCHIVED', archivedAvailable = null, duplicateId = null } = {}) {
  const ledger = {};
  const quantities = { CASE: 1, UNIT: -2 };
  let writes = 0;
  const context = vm.createContext({
    ...conversion, crypto, path, PERSISTENT_DIR: require('node:os').tmpdir(),
    require: require('node:module').createRequire(require.resolve('../server.js')),
    posReceiptInFlight: new Set(), loadPosLedger: () => ledger,
    writePosLedgerEntry: (key, entry) => { ledger[key] = { ...ledger[key], ...entry }; },
    posShopifyGraphQL: async (query, variables) => {
      if (query.includes('query ExactMappedVariant')) {
        const isCase = variables.id === line.caseVariantId;
        const kind = isCase ? 'CASE' : 'UNIT';
        return { productVariant: {
          id: variables.id, sku: isCase ? caseSku : line.unitSku,
          barcode: isCase ? '810193923624' : line.unitBarcode,
          price: isCase ? '0' : '2.59', product: { status: 'ACTIVE', tags: [] },
          inventoryItem: { id: kind, duplicateSkuCount: 1,
            unitCost: isCase ? { amount: '20.00' } : null,
            inventoryLevel: { quantities: [{ name: 'available', quantity: quantities[kind] }] },
          },
        } };
      }
      if (query.includes('query ExactArchivedSkuDuplicate')) {
        const isCase = variables.search === `sku:${caseSku}`;
        const sku = isCase ? caseSku : line.unitSku;
        return { productVariants: { pageInfo: { hasNextPage: false }, nodes: [
          { id: isCase ? line.caseVariantId : line.unitVariantId, sku, product: { status: 'ACTIVE' } },
          { id: duplicateId || (isCase ? line.archivedCaseVariantId : line.archivedUnitVariantId),
            sku, product: { status: archivedStatus }, inventoryItem: {
              inventoryLevel: archivedAvailable === null ? null :
                { quantities: [{ name: 'available', quantity: archivedAvailable }] },
            } },
        ] } };
      }
      assert.match(query, /inventoryAdjustQuantities/);
      writes++;
      for (const change of variables.input.changes) {
        assert.equal(change.changeFromQuantity, quantities[change.inventoryItemId]);
        quantities[change.inventoryItemId] += change.delta;
      }
      return { inventoryAdjustQuantities: { inventoryAdjustmentGroup: { id: 'test-adjustment' }, userErrors: [] } };
    },
  });
  const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('async function exactInventoryItem('),
    source.indexOf('// In-memory cache, refreshed on demand')), context);
  return { context, quantities, writes: () => writes };
}

test('the two fulfilled Peaches & Honey cases map to the active 12-can POS variant exactly once', async () => {
  assert.deepEqual([line.caseVariantId, line.unitVariantId, line.unitSku, line.unitBarcode, line.unitsPerCase], [
    'gid://shopify/ProductVariant/51397804458231',
    'gid://shopify/ProductVariant/51397808390391', '810193923617', '810193923617', 12,
  ]);
  for (const store of ['Bellmore', 'Lynbrook']) {
    const h = harness();
    const posted = await h.context.convertOneReceivedLine(store, `test-${store}`, store, line);
    assert.equal(posted.status, 'posted');
    assert.equal(posted.units, 12);
    assert.deepEqual(h.quantities, { CASE: 0, UNIT: 10 });
    assert.equal((await h.context.convertOneReceivedLine(store, `test-${store}`, store, line)).status, 'already_posted');
    assert.equal(h.writes(), 1);
  }
});

test('changed or stocked duplicate catalog variants block conversion before inventory writes', async () => {
  for (const options of [
    { archivedStatus: 'ACTIVE' },
    { archivedAvailable: 1 },
    { duplicateId: 'gid://shopify/ProductVariant/999' },
  ]) {
    const h = harness(options);
    await assert.rejects(h.context.convertOneReceivedLine('Lynbrook', 'test-order', 'store', line),
      /unverified duplicate SKU/);
    assert.equal(h.writes(), 0);
  }
});
