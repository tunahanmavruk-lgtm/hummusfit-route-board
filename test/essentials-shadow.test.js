const test = require('node:test');
const assert = require('node:assert/strict');

const { buildEssentialsShadow, essentialsTypeFor } = require('../essentials-shadow');

test('uses exact Shopify classifications for drinks, snacks, and store supplies', () => {
  assert.equal(essentialsTypeFor({
    title: 'Protein Cold Brew',
    productCollections: [{ title: 'Retail Essentials', handle: 'retail-essentials' }],
  }), 'retail');
  assert.equal(essentialsTypeFor({
    title: 'Chocolate Protein Crisps',
    productTags: ['featured', 'Retail Essentials'],
  }), 'retail');
  assert.equal(essentialsTypeFor({
    title: 'Straws and Cups — Case',
    productCollections: [{ title: 'Other Essentials', handle: 'other-essentials' }],
  }), 'other');
  assert.equal(essentialsTypeFor({ title: 'Chicken Stir Fry' }), null);
  assert.equal(essentialsTypeFor({ title: 'Retail-Style Frozen Chicken Bowl' }), null, 'generic retail wording must not opt food into Essentials');
});

test('normalizes exact Shopify collection handles and preserves explicit precedence', () => {
  assert.equal(essentialsTypeFor({
    title: 'Uninformative Product Name',
    productCollections: [{ title: 'Seasonal', handle: 'retail_essentials' }],
  }), 'retail');
  assert.equal(essentialsTypeFor({
    title: 'Paper Cups',
    productTags: ['Other Essentials', 'Retail Essentials'],
  }), 'retail');
});

test('excludes apparel even when Shopify metadata is assigned incorrectly', () => {
  for (const title of [
    'Hummus Fit Crop Hoodie',
    'Logo T-Shirt',
    'Performance Hat',
    'Training Leggings',
  ]) {
    assert.equal(essentialsTypeFor({
      title,
      productTags: ['Retail Essentials'],
      productCollections: [{ title: 'Retail Essentials', handle: 'retail-essentials' }],
    }), null, `${title} must never enter an Essentials catalog`);
  }
});

test('builds a combined read-only shadow queue without removing or mutating regular lines', () => {
  const regularOrders = {
    lynbrook: {
      orderId: 'gid://shopify/Order/1',
      orderName: '#1001',
      lineItems: [
        { title: 'Chicken Stir Fry', sku: 'FOOD-1', quantity: 12 },
        { title: 'Protein Cold Brew', sku: 'DRINK-1', quantity: 2, productCollections: [{ title: 'Retail Essentials', handle: 'retail-essentials' }] },
        { title: 'Black Plastic Forks — Case', sku: 'SUP-1', quantity: 3, productTags: ['Other Essentials'] },
      ],
    },
  };
  const before = JSON.parse(JSON.stringify(regularOrders));
  const cards = buildEssentialsShadow(regularOrders, {}, () => 'Route #2');

  assert.deepEqual(regularOrders, before, 'regular orders and every line must remain byte-for-byte equivalent');
  assert.equal(regularOrders.lynbrook.lineItems.length, 3, 'food and Essentials lines stay together on the regular order');
  assert.equal(cards.length, 1, 'one regular store/order must yield one combined Essentials card');
  const [card] = cards;
  assert.equal(card.regularOrderId, 'gid://shopify/Order/1');
  assert.equal(card.regularOrderName, '#1001');
  assert.deepEqual(card.types.sort(), ['other', 'retail']);
  assert.deepEqual(card.items.map(item => item.type).sort(), ['other', 'retail']);
  assert.equal(card.items.some(item => item.sku === 'FOOD-1'), false, 'food is excluded only from the derived view');
  assert.equal(card.caseCount, 5, 'Retail and Other quantities are combined on one operational card');
  assert.equal(card.stage, 'new');
  const sourceEssential = regularOrders.lynbrook.lineItems.find(item => item.sku === card.items[0].sku);
  assert.notEqual(card.items[0], sourceEssential, 'shadow results must be copies, never live line references');
});

test('derives stages and exceptions from a read-only picking snapshot', () => {
  const orders = {
    farmingdale: {
      orderId: 'gid://shopify/Order/2',
      orderName: '#1002',
      lineItems: [
        { title: 'Protein Cold Brew', sku: 'DRINK-2', quantity: 2, productTags: ['Retail Essentials'] },
        { title: 'Paper Cups — Case', sku: 'SUP-2', quantity: 4, productTags: ['Other Essentials'] },
      ],
    },
  };
  const retailKey = 'Protein Cold Brew::DRINK-2';
  const otherKey = 'Paper Cups — Case::SUP-2';
  const picking = {
    farmingdale: {
      itemStatus: { [retailKey]: 'picked', [otherKey]: 'partial' },
      itemPickedQty: { [otherKey]: 3 },
      itemCrateNumber: { [retailKey]: 1, [otherKey]: 1 },
      closedCrates: [1],
    },
  };
  const before = JSON.parse(JSON.stringify(picking));
  const [card] = buildEssentialsShadow(orders, picking);
  assert.deepEqual(picking, before);
  assert.equal(card.stage, 'labeled');
  assert.equal(card.progress, 83, 'progress is combined across Retail and Other Essentials');
  assert.equal(card.hasException, true);
  assert.deepEqual(card.types.sort(), ['other', 'retail']);
});
