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

module.exports = { barcodeVariants, upcACheckDigit };
