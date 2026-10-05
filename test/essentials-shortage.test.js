const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEssentialsStatus, essentialsLineResolved } = require('../essentials-shortage.js');

test('unavailable case can be recorded without a label', () => {
  assert.equal(validateEssentialsStatus('missing', undefined, 0, 3), null);
  assert.match(validateEssentialsStatus('missing', undefined, 1, 3), /already labeled/);
});

test('short case count must match physical cases already labeled', () => {
  assert.equal(validateEssentialsStatus('partial', 2, 2, 3), null);
  assert.match(validateEssentialsStatus('partial', 1, 2, 3), /Label each available case/);
  assert.match(validateEssentialsStatus('partial', 2, 0, 3), /Label each available case/);
  assert.match(validateEssentialsStatus('partial', 2, 3, 3), /Label each available case/);
});

test('reopening a shortage permits additional case labels without inventing picked cases', () => {
  assert.equal(validateEssentialsStatus('not_picked', undefined, 2, 3), null);
  assert.match(validateEssentialsStatus('picked', undefined, 2, 3), /Label all ordered cases/);
  assert.equal(validateEssentialsStatus('picked', undefined, 3, 3), null);
  assert.match(validateEssentialsStatus('not_picked', undefined, 3, 3), /already labeled/);
});

test('finishing accepts reviewed shortages but not unlabeled or unresolved cases', () => {
  assert.equal(essentialsLineResolved('missing', undefined, 0, 3), true);
  assert.equal(essentialsLineResolved('partial', 2, 2, 3), true);
  assert.equal(essentialsLineResolved('picked', undefined, 3, 3), true);
  assert.equal(essentialsLineResolved('not_picked', undefined, 2, 3), false);
  assert.equal(essentialsLineResolved('partial', 2, 1, 3), false);
  assert.equal(essentialsLineResolved('missing', undefined, 1, 3), false);
});
