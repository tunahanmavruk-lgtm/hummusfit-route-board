const test = require("node:test");
const assert = require("node:assert/strict");

const {
  barcodeVariants,
  upcACheckDigit,
  barcodeCodesForProduct,
  barcodeMatches,
} = require("../barcode");

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

test("accepts both Shopify and confirmed package barcodes for Basic Baddie", () => {
  const codes = barcodeCodesForProduct(
    "Basic Baddie Pumpkin Exclusive",
    "641837885080",
    "",
  );
  assert.deepEqual(codes, ["641837885080", "641837881303"]);
  assert.ok(barcodeMatches("641837885080", codes));
  assert.ok(barcodeMatches("64183788130", codes));
  assert.ok(barcodeMatches("641837881303", codes));
  assert.ok(!barcodeMatches("641837884540", codes));
});

test("matches the observed Blue Raspberry case label only to its exact order line", () => {
  const blue = barcodeCodesForProduct(
    "CASE — Sour Strips — 12 × 3.4 oz Bags — Blue Raspberry",
    "",
    "HF-SOURSTRIPS-BLUERASPBERRY-CS12",
  );
  const mango = barcodeCodesForProduct(
    "CASE — Sour Strips — 12 × 3.4 oz Bags — Tropical Mango",
    "",
    "HF-SOURSTRIPS-TROPICALMANGO-CS12",
  );
  assert.ok(barcodeMatches("0110860001800507", blue));
  assert.ok(barcodeMatches("10860001800507", blue));
  assert.ok(!barcodeMatches("0110860001800507", mango));
});
