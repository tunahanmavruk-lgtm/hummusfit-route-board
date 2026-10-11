const { barcodeVariants, barcodeMatches } = require("./barcode");

function catalogSearches(code) {
  const normalized = String(code || "").trim();
  if (!/^[A-Za-z0-9_-]{5,60}$/.test(normalized)) return [];
  return [...barcodeVariants(normalized)].flatMap((candidate) =>
    ["barcode", "sku"].map((field) => `${field}:${candidate}`));
}

function exactCatalogMatch(code, nodes) {
  const matches = new Map();
  for (const node of nodes || []) {
    if (node?.id && barcodeMatches(code, [node.barcode, node.sku])) matches.set(node.id, node);
  }
  return matches.size === 1 ? { status: "matched", variant: [...matches.values()][0] } :
    { status: matches.size ? "ambiguous" : "unmatched" };
}

module.exports = { catalogSearches, exactCatalogMatch };
