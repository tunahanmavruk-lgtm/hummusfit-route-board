const test = require("node:test");
const assert = require("node:assert/strict");

const { barcodeVariants, upcACheckDigit } = require("../barcode");

test("calculates the UPC-A check digits omitted by the affected NETUM scanner", () => {
  assert.equal(upcACheckDigit("64183788454"), "0");
  assert.equal(upcACheckDigit("60494719437"), "4");
});

test("restores an omitted UPC-A check digit as an exact barcode variant", () => {
  assert.deepEqual(
    [...barcodeVariants("64183788454")],
    ["64183788454", "641837884540", "064183788454"],
  );
  assert.ok(barcodeVariants("60494719437").has("604947194374"));
});

test("does not invent a check digit for nonnumeric or differently sized scans", () => {
  assert.equal(upcACheckDigit("ABC12345678"), null);
  assert.deepEqual([...barcodeVariants("ABC12345678")], ["ABC12345678"]);
  assert.ok(!barcodeVariants("123456789012").has("1234567890128"));
});

test("preserves existing leading-zero compatibility", () => {
  assert.ok(barcodeVariants("0123456789012").has("123456789012"));
  assert.ok(barcodeVariants("123456789012").has("0123456789012"));
});
