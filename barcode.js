function upcACheckDigit(dataDigits) {
  if (!/^\d{11}$/.test(dataDigits)) return null;

  let sum = 0;
  for (let i = 0; i < dataDigits.length; i++) {
    const digit = Number(dataDigits[i]);
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  return String((10 - (sum % 10)) % 10);
}

function barcodeVariants(scannedCode) {
  const code = String(scannedCode || "").trim();
  const variants = new Set([code]);

  // Some NETUM configurations transmit UPC-A's 11 data digits but omit
  // the twelfth (check) digit. Restore it deterministically. This does not
  // make a fuzzy match: picking still requires one of these exact values to
  // equal an SKU on the active order.
  if (/^\d{11}$/.test(code)) {
    variants.add(code + upcACheckDigit(code));
  }

  // Treat an EAN-13 leading zero and its UPC-A representation as the same
  // physical barcode, regardless of which form Shopify stores as the SKU.
  if (/^0\d+$/.test(code)) variants.add(code.replace(/^0/, ""));
  if (/^\d+$/.test(code)) variants.add("0" + code);

  return variants;
}

// Physical packaging can remain in circulation after a Shopify variant's
// primary barcode changes. Keep confirmed package codes as aliases so both
// generations scan while old inventory is being used up.
const PRODUCT_BARCODE_ALIASES = new Map([
  ["basic baddie pumpkin exclusive", ["641837881303"]],
]);

function barcodeCodesForProduct(title, primaryCode, sku) {
  const codes = new Set();
  for (const value of [primaryCode, sku]) {
    const code = String(value || "").trim();
    if (code) codes.add(code);
  }
  const aliases = PRODUCT_BARCODE_ALIASES.get(String(title || "").trim().toLowerCase()) || [];
  for (const alias of aliases) codes.add(alias);
  return [...codes];
}

function barcodeMatches(scannedCode, expectedCodes) {
  const scanned = String(scannedCode || "").trim();
  if (!scanned) return false;
  const scannedVariants = barcodeVariants(scanned);
  return (expectedCodes || []).some((value) => {
    const expected = String(value || "").trim();
    return expected && (
      scannedVariants.has(expected) ||
      barcodeVariants(expected).has(scanned)
    );
  });
}

module.exports = {
  barcodeVariants,
  upcACheckDigit,
  barcodeCodesForProduct,
  barcodeMatches,
};
