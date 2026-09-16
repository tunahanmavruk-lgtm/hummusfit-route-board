const assert = require('node:assert/strict');
const test = require('node:test');
const createCrateLabelZpl = require('../public/crate-label-zpl.js');

test('builds one 4x3 Zebra job with crate-specific items', () => {
  const zpl = createCrateLabelZpl({
    routeName: 'Long Island Route 3', stopNameUpper: 'Total Nutrition Syosset',
    orderName: '#1234', pickedBy: 'Warehouse',
    crateItems: [{ quantity: 8, title: 'Chicken Bowl' }, { quantity: 2, title: 'Steak Bowl' }],
  }, 2);
  assert.match(zpl, /\^PW812\n\^LL617/);
  assert.match(zpl, /\^FDCRATE 2\^FS/);
  assert.match(zpl, /\^FDChicken Bowl\^FS/);
  assert.match(zpl, /\^FDSteak Bowl\^FS/);
  assert.equal((zpl.match(/\^XA/g) || []).length, 1);
  assert.equal((zpl.match(/\^XZ/g) || []).length, 1);
});

test('keeps a crowded crate inside one label and neutralizes ZPL commands in order text', () => {
  const zpl = createCrateLabelZpl({
    stopNameUpper: 'TEST', orderName: '^JUS~JA',
    crateItems: Array.from({ length: 30 }, (_, index) => ({ quantity:index + 1, title:'Meal ' + (index + 1) })),
  }, 1);
  assert.doesNotMatch(zpl, /\^JUS|~JA/);
  assert.match(zpl, /more - packing slip/);
  assert.equal((zpl.match(/\^XZ/g) || []).length, 1);
  assert.throws(() => createCrateLabelZpl({ crateItems:[] }, 1), /empty crate/);
});
