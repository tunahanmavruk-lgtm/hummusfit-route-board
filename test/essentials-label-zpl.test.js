const test = require('node:test');
const assert = require('node:assert/strict');

const { createEssentialsCaseLabelZpl, createEssentialsLabelZpl } = require('../public/essentials-label-zpl');

test('builds one 3x1 label for each scanned Essentials case', () => {
  const zpl = createEssentialsCaseLabelZpl({
    stopNameUpper: 'LINDENHURST',
    orderName: '#1234',
    itemTitle: 'Paper Cups — Case',
    caseNumber: 2,
    totalCases: 3,
  });
  assert.match(zpl, /\^PW609/);
  assert.match(zpl, /\^LL203/);
  assert.match(zpl, /\^PQ1,0,1,N/);
  assert.match(zpl, /\^FDLINDENHURST\^FS/);
  assert.match(zpl, /\^FDCASE 2 OF 3\^FS/);
  assert.match(zpl, /PAPER CUPS CASE/);
  assert.equal((zpl.match(/\^XA/g) || []).length, 1);
  assert.equal((zpl.match(/\^XZ/g) || []).length, 1);
  assert.doesNotMatch(zpl, /\^BC|\^B3/);
});

test('builds exactly one 3x1 203-dpi Essentials label', () => {
  const zpl = createEssentialsLabelZpl({
    stopNameUpper: 'LINDENHURST',
    orderName: '#1234',
    crateItems: [{ title: 'Protein Cold Brew', quantity: 3 }],
  }, 2);
  assert.match(zpl, /\^PW609/);
  assert.match(zpl, /\^LL203/);
  assert.match(zpl, /\^PQ1,0,1,N/);
  assert.match(zpl, /\^FDLINDENHURST\^FS/);
  assert.match(zpl, /\^FDCRATE 2\^FS/);
  assert.match(zpl, /\^FDQTY 3\^FS/);
  assert.equal((zpl.match(/\^XA/g) || []).length, 1);
  assert.equal((zpl.match(/\^XZ/g) || []).length, 1);
  assert.doesNotMatch(zpl, /\^BC|\^B3/, 'the verified compact layout intentionally has no overlapping barcode');
});

test('neutralizes ZPL control characters in order data', () => {
  const zpl = createEssentialsLabelZpl({
    stopNameUpper: 'STORE^XZ~JA',
    orderName: '#1^FO0,0',
    crateItems: [],
  }, 1);
  assert.equal((zpl.match(/\^XZ/g) || []).length, 1);
  assert.doesNotMatch(zpl, /~JA/);
});
