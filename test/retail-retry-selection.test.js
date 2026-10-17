const test = require('node:test');
const assert = require('node:assert/strict');
const {selectedRetailBatches: select} = require('../retail-retry-selection');
const batches = [{orderId:'one', lines:[{caseSku:'A'},{caseSku:'B'}]}];
test('scoped retry preserves order identity and excludes unrelated conversions',()=>{
  assert.equal(select(batches,undefined),batches);
  assert.deepEqual(select(batches,['B']),[{orderId:'one',lines:[{caseSku:'B'}]}]);
  assert.equal(batches[0].lines.length,2);
});
test('invalid and ambiguous selections fail before any write',()=>{
  for(const selection of [[],['A','A'],['C'],'A',[null]]) assert.throws(()=>select(batches,selection));
  assert.throws(()=>select([...batches,...batches],['A']));
});
