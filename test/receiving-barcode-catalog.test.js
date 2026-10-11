const test = require('node:test');
const assert = require('node:assert/strict');
const { catalogSearches, exactCatalogMatch } = require('../receiving-barcode-catalog');

test('catalog lookup searches UPC/EAN equivalents but not arbitrary text', () => {
  const searches = catalogSearches('604947193711');
  assert.ok(searches.includes('barcode:604947193711'));
  assert.ok(searches.includes('sku:0604947193711'));
  assert.deepEqual(catalogSearches('Grilled chicken pesto wrap 3x'), []);
});

test('catalog lookup resolves one exact physical code and never chooses duplicate variants', () => {
  const pesto = { id:'gid://shopify/ProductVariant/1', sku:'604947193711', barcode:'604947193711' };
  assert.deepEqual(exactCatalogMatch('604947193711', [pesto,pesto]), { status:'matched', variant:pesto });
  assert.deepEqual(exactCatalogMatch('604947193711', [pesto,{ id:'gid://shopify/ProductVariant/2', barcode:'604947193711' }]),
    { status:'ambiguous' });
  assert.deepEqual(exactCatalogMatch('604947193711', [{ id:'gid://shopify/ProductVariant/3', barcode:'999999999999' }]),
    { status:'unmatched' });
});
