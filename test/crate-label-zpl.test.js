const assert = require('node:assert/strict');
const test = require('node:test');
const createCrateLabelZpl = require('../public/crate-label-zpl.js');

test('builds one 4x3 Zebra job with crate-specific items', () => {
  const zpl = createCrateLabelZpl({
    routeName: 'Long Island Route 3', stopNameUpper: 'Total Nutrition Syosset',
    orderName: '#1234', pickedBy: 'Warehouse',
    crateItems: [{ quantity: 8, title: 'Chicken Bowl' }, { quantity: 2, title: 'Steak Bowl' }],
  }, 2);
  assert.match(zpl, /\^PW812\n\^LL646\n\^LH0,18/);
  assert.match(zpl, /\^FDCRATE\^FS/);
  assert.match(zpl, /\^FD2\^FS/);
  assert.match(zpl, /\^FDChicken Bowl\^FS/);
  assert.match(zpl, /\^FDSteak Bowl\^FS/);
  assert.equal((zpl.match(/\^XA/g) || []).length, 1);
  assert.equal((zpl.match(/\^XZ/g) || []).length, 1);
});

test('prints every crowded-crate item on numbered continuation labels and neutralizes ZPL commands', () => {
  const zpl = createCrateLabelZpl({
    stopNameUpper: 'TEST', orderName: '^JUS~JA',
    crateItems: Array.from({ length: 30 }, (_, index) => ({ quantity:index + 1, title:'Meal ' + (index + 1) })),
  }, 1);
  assert.doesNotMatch(zpl, /\^JUS|~JA/);
  assert.match(zpl, /\^FDLABEL 1\/2\^FS/);
  assert.match(zpl, /\^FDLABEL 2\/2\^FS/);
  for (let i = 1; i <= 30; i++) assert.match(zpl, new RegExp('\\^FDMeal ' + i + '\\^FS'));
  assert.doesNotMatch(zpl, /more - packing slip/);
  assert.equal((zpl.match(/\^XZ/g) || []).length, 2);
  assert.equal(createCrateLabelZpl.pages({
    stopNameUpper:'TEST', crateItems:Array.from({ length:30 }, (_, i) => ({ quantity:1, title:'Meal ' + i }))
  }, 1).length, 2);
  assert.throws(() => createCrateLabelZpl({ crateItems:[] }, 1), /empty crate/);
});

test('keeps a long product name complete across wrapped lines', () => {
  const title = 'BBQ Chicken Garlic Parm Potatoes with Roasted Vegetables and House Sauce';
  const zpl = createCrateLabelZpl({
    stopNameUpper:'MERIDEN', identity:{ monogram:'MER', pattern:'diagonal' },
    crateItems:[{ quantity:20, title }]
  }, 1);
  assert.match(zpl, /\^FDMER\^FS/);
  assert.match(zpl, /BBQ Chicken Garlic Parm Potatoes/);
  assert.match(zpl, /Roasted Vegetables and House Sauce/);
});
