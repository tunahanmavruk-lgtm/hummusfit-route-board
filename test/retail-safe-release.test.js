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
  ["MF-7170515-CS","51226012811511","51226012844279","850075829255",15],
  ["MF-7170514-CS","51260314419447","51226013008119","850036648932",15],
  ["MF-7171008-CS","51226012549367","51226012582135","850036648581",15],
  ["MF-7171000-CS","51259630092535","51226012778743","850026196122",15],
  ["POINTS-DARK-CS","51233895842039","51233895612663","860008611826",12],
  ["MF-7171013-CS","51259630059767","51226012680439","850062928794",15],
  ["MF-7171015-CS","51259630125303","51226012942583","850062928510",15],
  ["MF-7700008-CS","51260314616055","51226013434103","860014554520",12],
  ["MF-6310672-CS","51226013073655","51226013106423","810137322902",12],
  ["MF-7700006-CS","51226013270263","51226013335799","810193920500",12],
  ["MF-7700004-CS","51260314648823","51226013565175","850069104801",12],
  ["MF-7700005-CS","51260314681591","51226013630711","850069104993",12],
  ["MF-7320011-CS","51226012418295","51226012483831","850063790383",12],
  ["MF-6310019-CS","51259630158071","51226013171959","850041914749",12],
  ["MF-7760001-P1","51510660563191","51510541877495","628942370793",1],
  ["MF-7760004-P1","51510660595959","51510541910263","628942370755",1],
  ["MF-7760012-P1","51510660628727","51510541943031","628942370830",1],
  ["MF-7760014-P1","51510660661495","51510541975799","628340660090",1],
  ["MF-7610061-P1","51510660825335","51510542041335","847644011449",1],
  ["MF-7610062-P1","51510660858103","51510542074103","847644011432",1],
  ["MF-8670041-CS","51510542172407","51510542106871","889392003185",12],
  ["GLOBAL GT628004-CS6","51304197292279","51331378938103","8801094063283",6],
  ["Global GT628008-CS24","51317812330743","51331378708727","8801056044503",24],
  ["GLOBAL GT628019-CS6","51317812297975","51331378675959","8801056911379",6],
  ["GLOBAL GT628021-CS24","51304197914871","51331379036407","8801056175900",24],
  ["HF-DRIZZ-BC-4OZ-CS12","51322371768567","51134469701879","857900005402",12],
  ["HF-DRIZZ-CIN-4OZ-CS12","51322371801335","51322449330423","857900005167",12],
  ["HF-DRIZZ-VB-4OZ-CS12","51322371834103","51322455228663","853762002900",12],
  ["BUILT-PFB0374-CS12","51242437738743","51259495022839","840229307418",12],
  ['HF-SOURSTRIPS-LEMONBERRY-CS12', '51317893234935', '51317895069943', '860004712527'],
  ['HF-SOURSTRIPS-APPLEBERRY-CS12', '51317893267703', '50348807389431', '860001800593'],
  ['HF-SOURSTRIPS-GREENAPPLE-CS12', '51317893300471', '50348807323895', '860001800548'],
  ['HF-SOURSTRIPS-STRAWBERRY-CS12', '51317893333239', '50348807422199', '860001800517'],
  ['HF-BUILT-SOURPUFF-GREENAPPLE-CS12', '51317893366007', '51317895364855', '840229306558'],
  ['HF-BUILT-SOURPUFF-PINKLEMONADE-CS12', '51317893398775', '51317895397623', '840229306794'],
  ['HF-NYB-BUCKEDUP-700-P3', '51376821272823', '51279797092599', '810203842808', 3],
  ['HF-NYB-BUCKEDUP-701-P3', '51376821305591', '51279797125367', '810203842815', 3],
  ["HF-NYB-NOCCO-402-C12","51322016727287","50622668964087","850064950021",12],
  ["HF-NYB-NOCCO-222-C12","51322016760055","51085963100407","850075778454",12],
  ["HF-NYB-NOCCO-219-C12","51322016792823","50644958511351","850075778447",12],
  ["HF-NYB-NOCCO-216-C12","51322016825591","51085963034871","850064950700",12],
  ["HF-NYB-NOCCO-218-C12","51322016858359","50622667620599","850075778270",12],
  ["HF-NYB-FL-101-C12","51322014105847","51322121683191","811620020633",12],
  ["HF-NYB-GHOST-118-C12","51322014171383","51322123616503","810128529853",12],
  ["HF-NYB-QUEST3106-C8","51322014040311","50344585986295","888849016136",8],
  ["HF-SUFFOLK-MON-JP-WHITE-C24","51322197999863","51322304102647","4897036690895",24],
  ["HF-SUFFOLK-MON-JP-BLUE-C24","51322198032631","51322304135415","4897036690055",24],
  ["HF-SUFFOLK-MON-JP-BLUE-C24-ORDER","51432898101495","51322304135415","4897036690055",24],
  ["HF-SUFFOLK-MON-KR-STRAWBERRY-C24-ORDER","51432898199799","51391900680439","4897036695203",24],
  ["HF-SUFFOLK-MON-JP-PEACH-C24","51322198065399","51322304168183","4897036694466",24],
  ["HF-SUFFOLK-MON-JP-PARADISE-C24","51322198098167","51322304200951","4897036692707",24],
];

function harness(t, line, { loseResponse = false, inactive = false, unitBarcode = line.unitBarcode } = {}) {
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
    const context = vm.createContext({ ...conversion, ...history, fs, process, require:require("node:module").createRequire(require.resolve("../server.js")), path, PERSISTENT_DIR:dir, crypto: require('node:crypto'),
      Date: { now: () => clock }, POS_LEDGER_FILE: file, posReceiptInFlight: new Set(),
      posShopifyGraphQL: async (query, variables) => {
        calls++;
        if (query.includes('query ExactMappedVariant')) {
          const isCase = variables.id === line.caseVariantId;
          const kind = isCase ? 'CASE' : 'UNIT';
          return { productVariant: { id: variables.id, sku: isCase ? line.caseSku : line.unitSku,
            barcode: isCase ? null : unitBarcode, price: isCase ? '0' : '4.15',
            product: { status: 'ACTIVE', tags: isCase ? (line.allowSharedProductMappingPendingTag ? ['mapping-pending'] : []) : ['pos-sell-unit'] },
            inventoryItem: { id: kind, duplicateSkuCount: 0, unitCost: { amount: isCase ? String(line.unitsPerCase * 2.17) : '2.17' },
              inventoryLevel: isCase || active ? { quantities: [{ name: 'available', quantity: quantities[kind] }] } : null } } };
        }
        if (query.includes('mutation ActivateReceivedSellUnit')) {
          assert.doesNotMatch(query, /(?:available|onHand)\s*:/);
          active = true;
          assert.equal(variables.inventoryItemId, 'UNIT');
          return { inventoryActivate: { inventoryLevel: { id: 'level' }, userErrors: [] } };
        }
        assert.match(query, /inventoryAdjustQuantities/);
        assert.match(query, /@idempotent/);
        // Actual durable history must exist before the mutation is sent.
        const saved = history.readConversionLedger(file)[variables.input.referenceDocumentUri.split('/').at(-1)];
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
  return { createContext, file, dir, quantities, requests, writes: () => writes, calls: () => calls, advance: ms => { clock += ms; } };
}

for (const [sku, caseId, unitId, barcode, unitsPerCase = 12] of pairs) {
  test(`${sku}: all 14 stores, actual persisted history, retry/restart and zero-stock activation`, async t => {
    const line = { ...conversion.caseMapping({ sku, productTags: ['retail-essentials'] }), receivedCases: 2 };
    assert.equal(line.unitsPerCase, unitsPerCase);
    assert.equal(line.caseVariantId, `gid://shopify/ProductVariant/${caseId}`);
    assert.equal(line.unitVariantId, `gid://shopify/ProductVariant/${unitId}`);
    assert.equal(line.unitBarcode, barcode);
    for (const store of Object.keys(conversion.POS_STORE_LOCATIONS)) {
      const h = harness(t, line, { inactive: true, loseResponse: true });
      await assert.rejects(h.createContext().convertOneReceivedLine(store, 'test-order', store, line), /lost response/);
      const restart = h.createContext();
      assert.equal((await restart.convertOneReceivedLine(store, 'test-order', store, line)).status, 'posted');
      assert.equal((await restart.convertOneReceivedLine(store, 'test-order', store, line)).status, 'already_posted');
      assert.deepEqual(h.quantities, { CASE: 0, UNIT: 2 * unitsPerCase });
      assert.equal(h.writes(), 1);
      assert.equal(h.requests[0].key, h.requests[1].key);
      for (const change of h.requests[0].input.changes) assert.equal(change.locationId, store);
    }
  });
}

for (const [sku] of pairs) {
  test(`${sku}: incoming stock and wrong unit barcode cannot create inventory`, async t => {
    const line = { ...conversion.caseMapping({ sku, productCollections: [{title: 'Retail Essentials', handle: 'retail-essentials'}] }), receivedCases: 2 };
    assert.equal(conversion.caseMapping({ sku, productTags: [] }), null);
    for (const store of Object.keys(conversion.POS_STORE_LOCATIONS)) {
      const h = harness(t, line, { inactive: true });
      h.quantities.CASE = 0;
      await assert.rejects(h.createContext().convertOneReceivedLine(store, 'not-arrived', store, line), /Case stock has not arrived/);
      assert.equal(h.writes(), 0);
      assert.deepEqual(h.quantities, {CASE: 0, UNIT: 0});
      assert.deepEqual(history.readConversionLedger(h.file), {});
    }
    const wrong = harness(t, line, {unitBarcode: '000000000000'});
    await assert.rejects(wrong.createContext().convertOneReceivedLine('Holbrook', 'wrong-barcode', 'Holbrook', line), /barcode/);
    assert.equal(wrong.writes(), 0);
    assert.deepEqual(history.readConversionLedger(wrong.file), {});
  });
}

const line = { ...conversion.caseMapping({ sku: 'HF-SOURSTRIPS-LEMONBERRY-CS12', productTags: ['retail-essentials'] }), receivedCases: 2 };
test('reactivation preserves retained positive or negative stock before conversion and retry', async t => {
  for (const retained of [7, -1]) {
    const h = harness(t, line, { inactive: true, loseResponse: true });
    h.quantities.UNIT = retained;
    await assert.rejects(h.createContext().convertOneReceivedLine('Lynbrook', 'preserved-stock', 'Lynbrook', line), /lost response/);
    const retry = h.createContext();
    assert.equal((await retry.convertOneReceivedLine('Lynbrook', 'preserved-stock', 'Lynbrook', line)).status, 'posted');
    assert.equal((await retry.convertOneReceivedLine('Lynbrook', 'preserved-stock', 'Lynbrook', line)).status, 'already_posted');
    assert.equal(h.quantities.UNIT, retained + 24);
    assert.equal(h.writes(), 1);
    assert.equal(h.requests[0].input.changes.find(c => c.inventoryItemId === 'UNIT').changeFromQuantity, retained);
  }
});
test('BUILT Pink Lemonade refuses four-pack and box codes on its single-bar variant', async t => {
  const built = { ...conversion.caseMapping({ sku: 'HF-BUILT-SOURPUFF-PINKLEMONADE-CS12', productTags: ['retail-essentials'] }), receivedCases: 2 };
  for (const unitBarcode of ['840229306800', '840229306886']) {
    const h = harness(t, built, { unitBarcode });
    await assert.rejects(h.createContext().convertOneReceivedLine('Holbrook', 'test-order', 'Holbrook', built), /barcode/i);
    assert.equal(h.writes(), 0);
    assert.deepEqual(history.readConversionLedger(h.file), {});
  }
});

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

test('unverified Sprite mapping remains blocked', () => {
  for (const sku of ['HF-SPRITE-ZERO-TEA-350-CS24']) {
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

test('verified diagnostic reversal permits exactly one real conversion with a new Shopify request key',async t=>{
 const base={caseSku:pairs[0][0],...conversion.VERIFIED_CASE_MAPPINGS[pairs[0][0]],receivedCases:2};
 const h=harness(t,base),store='Holbrook',orderId='real-receipt-after-reversal',key=conversion.receiptKey(store,orderId,base.caseSku);
 await h.createContext().convertOneReceivedLine(store,orderId,store,base);assert.equal(h.writes(),1);
 h.quantities.CASE=2;h.quantities.UNIT=0;
 const ledger=JSON.parse(fs.readFileSync(h.file));delete ledger[key];fs.writeFileSync(h.file,JSON.stringify(ledger));
 const {nextConversionKey}=require('../conversion-request-key');fs.writeFileSync(path.join(h.dir,'invalid-diagnostic-reversals.json'),JSON.stringify({[key]:{status:'reversed_verified',originalAdjustmentId:'gid://shopify/InventoryAdjustmentGroup/1',reversalAdjustmentId:'gid://shopify/InventoryAdjustmentGroup/2',nextRequestKey:nextConversionKey(key)}}));
 await h.createContext().convertOneReceivedLine(store,orderId,store,base);assert.equal(h.writes(),2);assert.equal(h.quantities.CASE,0);assert.equal(h.quantities.UNIT,base.unitsPerCase*2);
 await h.createContext().convertOneReceivedLine(store,orderId,store,base);assert.equal(h.writes(),2);
});
