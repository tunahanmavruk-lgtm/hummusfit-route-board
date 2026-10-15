const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const conversion = require('../essentials-pos-conversion');
const history = require('../retail-conversion-ledger');
const source = fs.readFileSync(require.resolve('../server'), 'utf8');
const pairs = [
  ['LEMONBERRY', '51317893234935', '51317895069943', '860004712527'],
  ['APPLEBERRY', '51317893267703', '50348807389431', '860001800593'],
  ['GREENAPPLE', '51317893300471', '50348807323895', '860001800548'],
  ['STRAWBERRY', '51317893333239', '50348807422199', '860001800517'],
];

function harness(t, line, { loseResponse = false, inactive = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retail-safe-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'history.json');
  // Explicit initialization is test-only. Production never creates empty history.
  fs.writeFileSync(file, '{}');
  const quantities = { CASE: 2, UNIT: 0 };
  const results = new Map();
  const requests = [];
  let writes = 0, calls = 0, clock = Date.now(), active = !inactive;
  const createContext = () => {
    const context = vm.createContext({ ...conversion, ...history, fs, process, crypto: require('node:crypto'),
      Date: { now: () => clock }, POS_LEDGER_FILE: file, posReceiptInFlight: new Set(),
      posShopifyGraphQL: async (query, variables) => {
        calls++;
        if (query.includes('query ExactMappedVariant')) {
          const isCase = variables.id === line.caseVariantId;
          const kind = isCase ? 'CASE' : 'UNIT';
          return { productVariant: { id: variables.id, sku: isCase ? line.caseSku : line.unitSku,
            barcode: isCase ? null : line.unitBarcode, price: isCase ? '0' : '4.15',
            product: { status: 'ACTIVE', tags: isCase ? ['mapping-pending'] : [] },
            inventoryItem: { id: kind, duplicateSkuCount: 0, unitCost: { amount: isCase ? '26' : '2.17' },
              inventoryLevel: isCase || active ? { quantities: [{ name: 'available', quantity: quantities[kind] }] } : null } } };
        }
        if (query.includes('mutation ActivateReceivedSellUnit')) {
          active = true;
          assert.equal(variables.inventoryItemId, 'UNIT');
          return { inventoryActivate: { inventoryLevel: { id: 'level' }, userErrors: [] } };
        }
        assert.match(query, /inventoryAdjustQuantities/);
        assert.match(query, /@idempotent/);
        // Actual durable history must exist before the mutation is sent.
        const saved = history.readConversionLedger(file)[variables.key];
        assert.equal(saved.status, 'pending');
        assert.deepEqual(JSON.parse(JSON.stringify(variables.input)), saved.plan.input);
        requests.push(variables);
        if (results.has(variables.key)) return results.get(variables.key);
        for (const change of variables.input.changes) {
          assert.equal(change.changeFromQuantity, quantities[change.inventoryItemId]);
          quantities[change.inventoryItemId] += change.delta;
        }
        writes++;
        const response = { inventoryAdjustQuantities: { inventoryAdjustmentGroup: { id: 'gid://shopify/InventoryAdjustmentGroup/1' }, userErrors: [] } };
        results.set(variables.key, response);
        if (loseResponse) { loseResponse = false; throw new Error('lost response'); }
        return response;
      },
    });
    vm.runInContext(source.slice(source.indexOf('function loadPosLedger('), source.indexOf('async function posShopifyGraphQL(')), context);
    vm.runInContext(source.slice(source.indexOf('async function exactInventoryItem('), source.indexOf('// In-memory cache, refreshed on demand')), context);
    return context;
  };
  return { createContext, file, quantities, requests, writes: () => writes, calls: () => calls, advance: ms => { clock += ms; } };
}

for (const [flavor, caseId, unitId, barcode] of pairs) {
  test(`Sour Strips ${flavor}: all 14 stores, actual persisted history, retry/restart and zero-stock activation`, async t => {
    const line = { ...conversion.caseMapping({ sku: `HF-SOURSTRIPS-${flavor}-CS12`, productTags: ['retail-essentials'] }), receivedCases: 2 };
    assert.equal(line.unitsPerCase, 12);
    assert.equal(line.caseVariantId, `gid://shopify/ProductVariant/${caseId}`);
    assert.equal(line.unitVariantId, `gid://shopify/ProductVariant/${unitId}`);
    assert.equal(line.unitBarcode, barcode);
    for (const store of Object.keys(conversion.POS_STORE_LOCATIONS)) {
      const h = harness(t, line, { inactive: true, loseResponse: true });
      await assert.rejects(h.createContext().convertOneReceivedLine(store, 'test-order', store, line), /lost response/);
      const restart = h.createContext();
      assert.equal((await restart.convertOneReceivedLine(store, 'test-order', store, line)).status, 'posted');
      assert.equal((await restart.convertOneReceivedLine(store, 'test-order', store, line)).status, 'already_posted');
      assert.deepEqual(h.quantities, { CASE: 0, UNIT: 24 });
      assert.equal(h.writes(), 1);
      assert.equal(h.requests[0].key, h.requests[1].key);
      for (const change of h.requests[0].input.changes) assert.equal(change.locationId, store);
    }
  });
}

const line = { ...conversion.caseMapping({ sku: 'HF-SOURSTRIPS-LEMONBERRY-CS12', productTags: ['retail-essentials'] }), receivedCases: 2 };
test('missing, unreadable, malformed and invalid-shaped history stop BEFORE any Shopify call', async t => {
  for (const bad of ['missing', 'directory', '', '{', 'null', '[]', '42', '{"bad":{"status":"posted"}}']) {
    const h = harness(t, line);
    if (bad === 'missing') fs.unlinkSync(h.file);
    else if (bad === 'directory') { fs.unlinkSync(h.file); fs.mkdirSync(h.file); }
    else fs.writeFileSync(h.file, bad);
    await assert.rejects(h.createContext().convertOneReceivedLine('Holbrook', 'test-order', 'Holbrook', line), /saved conversion history/);
    assert.equal(h.calls(), 0);
    assert.equal(h.writes(), 0);
  }
});

test('expired, legacy undated, future-dated and changed-count pending conversions require review without replay', async t => {
  for (const kind of ['expired', 'legacy', 'future', 'changed']) {
    const h = harness(t, line, { loseResponse: true });
    await assert.rejects(h.createContext().convertOneReceivedLine('Holbrook', 'test-order', 'Holbrook', line), /lost response/);
    const ledger = history.readConversionLedger(h.file);
    const entry = Object.values(ledger)[0];
    if (kind === 'expired') h.advance(23 * 60 * 60 * 1000);
    if (kind === 'legacy') delete entry.startedAt;
    if (kind === 'future') entry.startedAt += 100000;
    history.writeConversionLedger(h.file, ledger);
    const calls = h.calls();
    const result = await h.createContext().convertOneReceivedLine('Holbrook', 'test-order', 'Holbrook', kind === 'changed' ? { ...line, receivedCases: 1 } : line);
    assert.equal(result.status, 'requires_review');
    assert.equal(h.writes(), 1);
    assert.equal(h.calls(), calls);
  }
});

test('concurrent same-receipt calls cannot duplicate; failed entries stay held', async t => {
  const h = harness(t, line);
  const context = h.createContext();
  const results = await Promise.all([1, 2].map(() => context.convertOneReceivedLine('Holbrook', 'test-order', 'Holbrook', line)));
  assert.deepEqual(results.map(r => r.status).sort(), ['posted', 'processing']);
  assert.equal(h.writes(), 1);
  const ledger = history.readConversionLedger(h.file);
  Object.values(ledger)[0].status = 'failed';
  history.writeConversionLedger(h.file, ledger);
  assert.equal((await h.createContext().convertOneReceivedLine('Holbrook', 'test-order', 'Holbrook', line)).status, 'requires_review');
  assert.equal(h.writes(), 1);
});

test('unverified Sprite and BUILT mappings remain blocked', () => {
  for (const sku of ['HF-SPRITE-ZERO-TEA-350-CS24', 'HF-BUILT-SOURPUFF-GREENAPPLE-CS12', 'HF-BUILT-SOURPUFF-PINKLEMONADE-CS12']) {
    assert.match(conversion.caseMapping({ sku, productTags: ['retail-essentials'] }).error, /approved/);
  }
});

test('failure saving pending history stops mutation; failure saving posted proof retries only original request', async t => {
  for (const failureStatus of ['pending', 'posted']) {
    const h = harness(t, line);
    const context = h.createContext();
    const write = context.writePosLedgerEntry;
    context.writePosLedgerEntry = (key, entry) => {
      if (entry.status === failureStatus) throw new Error('disk write failure');
      return write(key, entry);
    };
    await assert.rejects(context.convertOneReceivedLine('Holbrook', 'test-order', 'Holbrook', line), /disk write failure/);
    assert.equal(h.writes(), failureStatus === 'pending' ? 0 : 1);
    const retry = await h.createContext().convertOneReceivedLine('Holbrook', 'test-order', 'Holbrook', line);
    assert.equal(retry.status, 'posted');
    assert.equal(h.writes(), 1);
    assert.deepEqual(h.quantities, { CASE: 0, UNIT: 24 });
  }
});
