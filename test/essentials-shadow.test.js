const test = require('node:test');
const assert = require('node:assert/strict');

const { buildEssentialsShadow, essentialsTypeFor } = require('../essentials-shadow');

test('classifies Retail and Other Essentials while leaving food out of the shadow view', () => {
  assert.equal(essentialsTypeFor({ title: 'Hummus Fit Crop Hoodie' }), 'retail');
  assert.equal(essentialsTypeFor({ title: 'Black Plastic Forks — Case' }), 'other');
  assert.equal(essentialsTypeFor({ title: 'Chicken Stir Fry' }), null);
});

test('builds a combined read-only shadow queue without removing or mutating regular lines', () => {
  const regularOrders = {
    lynbrook: {
      orderId: 'gid://shopify/Order/1',
      orderName: '#1001',
      lineItems: [
        { title: 'Chicken Stir Fry', sku: 'FOOD-1', quantity: 12 },
        { title: 'Hummus Fit Crop Hoodie', sku: 'RET-1', quantity: 2 },
        { title: 'Black Plastic Forks — Case', sku: 'SUP-1', quantity: 3 },
      ],
    },
  };
  const before = JSON.parse(JSON.stringify(regularOrders));
  const cards = buildEssentialsShadow(regularOrders, {}, () => 'Route #2');

  assert.deepEqual(regularOrders, before, 'regular orders and every line must remain byte-for-byte equivalent');
  assert.equal(regularOrders.lynbrook.lineItems.length, 3, 'food and Essentials lines stay together on the regular order');
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map(card => card.type).sort(), ['other', 'retail']);
  assert.equal(cards.reduce((sum, card) => sum + card.caseCount, 0), 5);
  assert.ok(cards.every(card => card.stage === 'new'));
  assert.notEqual(cards[0].items[0], regularOrders.lynbrook.lineItems[1], 'shadow results must be copies, never live line references');
});

test('derives stages and exceptions from a read-only picking snapshot', () => {
  const orders = {
    farmingdale: {
      orderId: 'gid://shopify/Order/2',
      orderName: '#1002',
      lineItems: [{ title: 'Paper Cups — Case', sku: 'SUP-2', quantity: 4 }],
    },
  };
  const itemKey = 'Paper Cups — Case::SUP-2';
  const picking = {
    farmingdale: {
      itemStatus: { [itemKey]: 'partial' },
      itemPickedQty: { [itemKey]: 3 },
      itemCrateNumber: { [itemKey]: 1 },
      closedCrates: [1],
    },
  };
  const before = JSON.parse(JSON.stringify(picking));
  const [card] = buildEssentialsShadow(orders, picking);
  assert.deepEqual(picking, before);
  assert.equal(card.stage, 'labeled');
  assert.equal(card.progress, 75);
  assert.equal(card.hasException, true);
});
