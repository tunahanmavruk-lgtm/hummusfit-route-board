const crypto = require("crypto");
const { essentialsTypeFor } = require("./essentials-shadow");

// Only catalog pairs that have been reviewed against the actual Shopify
// variants may change store inventory. The SKU suffix alone is not proof of
// a physical pack count or of which POS product should receive the units.
const VERIFIED_CASE_MAPPINGS = Object.freeze({
  "SS-4890008101306-CS8": Object.freeze({
    unitSku: "4890008101306", unitsPerCase: 8,
    caseVariantId: "gid://shopify/ProductVariant/51242421289207",
    unitVariantId: "gid://shopify/ProductVariant/51028267499767",
    unitBarcode: "4890008101306",
  }),
  "SS-8806002023472-CS24": Object.freeze({
    unitSku: "SS-8806002023472", unitsPerCase: 24,
    caseVariantId: "gid://shopify/ProductVariant/51242424631543",
    unitVariantId: "gid://shopify/ProductVariant/51259498889463",
    requirePosSellUnitTag: true,
    // Staff will select the exact POS SKU manually until its can barcode is verified.
    allowMissingBarcode: true,
  }),
  "BUILT-PFB0374-CS12": Object.freeze({
    unitSku: "BUILT-PFB0374", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51242437738743",
    unitVariantId: "gid://shopify/ProductVariant/51259495022839",
    requirePosSellUnitTag: true,
    allowMissingBarcode: true,
  }),
  "SD-PEACH-60G-CS8": Object.freeze({
    unitSku: "SD-PEACH-60G", unitsPerCase: 8,
    caseVariantId: "gid://shopify/ProductVariant/51242444226807",
    unitVariantId: "gid://shopify/ProductVariant/51259503444215",
    requirePosSellUnitTag: true,
    allowMissingBarcode: true,
  }),
});

// The 14 active Hummus Fit POS stores. Route Board calls East Islip "Islip";
// Shopify uses the full location name. The kitchen and shipping warehouse
// are intentionally absent, as are non-store/B2B stops.
const POS_STORE_LOCATIONS = Object.freeze({
  Bellmore: "Hummus Fit Bellmore",
  "Deer Park": "Hummus Fit Deer Park",
  Islip: "Hummus Fit East Islip",
  Farmingdale: "Hummus Fit Farmingdale",
  Holbrook: "Hummus Fit Holbrook",
  Huntington: "Hummus Fit Huntington",
  "Island Park": "Hummus Fit Island Park",
  "Lake Grove": "Hummus Fit Lake Grove",
  Lindenhurst: "Hummus Fit Lindenhurst",
  Lynbrook: "Hummus Fit Lynbrook",
  "Miller Place": "Hummus Fit Miller Place",
  Ronkonkoma: "Hummus Fit Ronkonkoma",
  Selden: "Hummus Fit Selden",
  Woodbury: "Hummus Fit Woodbury",
});

// Never infer a pack size or POS variant from a merchandising title or SKU.
function caseMapping(item) {
  if (essentialsTypeFor(item) !== "retail") return null;
  const caseSku = String(item.sku || "").trim();
  if (!caseSku) return {
    caseSku: String(item.title || "").trim(),
    error: "Retail Essentials case is missing a Shopify SKU and approved POS mapping",
  };
  const mapping = VERIFIED_CASE_MAPPINGS[caseSku];
  if (!mapping) return { caseSku, error: "Case SKU needs an approved case-to-POS-unit mapping" };
  return { caseSku, ...mapping };
}

function receiptLines(order, essentialsRecord, receivedCounts, readItemState) {
  const retail = (order.lineItems || []).filter((item) => essentialsTypeFor(item) === "retail");
  if (!retail.length) return [];
  if (!essentialsRecord || !essentialsRecord.completedAt || essentialsRecord.orderId !== order.orderId) {
    throw new Error("Essentials picking has not been completed for this exact order");
  }
  if (!receivedCounts || typeof receivedCounts !== "object" || Array.isArray(receivedCounts)) {
    throw new Error("Verified received case counts are required");
  }
  // The receiving UI keys manual entries for SKU-less products by title.
  // Preserve that key so one unmapped case cannot invalidate an otherwise
  // approved case conversion in the same verified store receipt.
  const receiptCountKey = (item) => String(item.sku || "").trim() || String(item.title || "").trim();
  const allowed = new Set(retail.map(receiptCountKey));
  for (const sku of Object.keys(receivedCounts)) {
    if (!allowed.has(sku)) throw new Error(`Unexpected receipt SKU: ${sku}`);
  }
  return retail.map((item, index) => {
    const workflowIndex = (order.lineItems || []).filter((entry) => essentialsTypeFor(entry)).indexOf(item);
    const status = readItemState(essentialsRecord.itemStatus, item, workflowIndex);
    const scanned = Number(readItemState(essentialsRecord.itemScannedCount, item, workflowIndex)) || 0;
    const receivedCases = Number(receivedCounts[receiptCountKey(item)]);
    if (status !== "picked" || scanned !== item.quantity) {
      throw new Error(`Essentials picking is not fully verified: ${item.sku || item.title}`);
    }
    if (!Number.isSafeInteger(receivedCases) || receivedCases < 0 || receivedCases > scanned) {
      throw new Error(`Invalid received case count: ${item.sku || item.title}`);
    }
    return { ...caseMapping(item), title: item.title, pickedCases: scanned, receivedCases, index };
  });
}

function receiptKey(store, orderId, caseSku) {
  return crypto.createHash("sha256").update(JSON.stringify([store, orderId, caseSku])).digest("hex");
}

function validateCaseAndUnit(line, caseItem, unitItem) {
  if (caseItem.mappingPending) throw new Error("Case-to-unit mapping is still pending catalog verification");
  if (!(caseItem.unitCost > 0) || !(unitItem.price > 0)) {
    throw new Error("Case cost and POS sell-unit price must be verified before conversion");
  }
  if (unitItem.price <= caseItem.unitCost / line.unitsPerCase) {
    throw new Error("POS sell-unit price does not exceed the case-derived unit cost; verify case count and cost");
  }
  if (caseItem.available < line.receivedCases) throw new Error("Case stock has not arrived at this Shopify location");
}

function adjustmentPlan(line, caseItem, unitItem, locationId, key) {
  validateCaseAndUnit(line, caseItem, unitItem);
  if (!Number.isSafeInteger(unitItem.available)) {
    throw new Error("POS sell-unit inventory is not active at this Shopify location");
  }
  const units = line.receivedCases * line.unitsPerCase;
  if (!Number.isSafeInteger(units) || units > 100000) throw new Error("Invalid sell-unit quantity");
  return {
    receivedCases: line.receivedCases,
    units,
    input: {
      name: "available", reason: "correction",
      referenceDocumentUri: `gid://hummusfit-receiving/CaseConversion/${key}`,
      changes: [
        { inventoryItemId: caseItem.id, locationId, delta: -line.receivedCases, changeFromQuantity: caseItem.available },
        { inventoryItemId: unitItem.id, locationId, delta: units, changeFromQuantity: unitItem.available },
      ],
    },
  };
}

function validateVariantRole(variant, mapping, requireSellable) {
  const expectedId = requireSellable ? mapping?.unitVariantId : mapping?.caseVariantId;
  if (expectedId && variant.id !== expectedId) {
    throw new Error(`${requireSellable ? "POS sell-unit" : "Case"} SKU ${variant.sku} no longer matches its approved Shopify variant`);
  }
}

module.exports = { caseMapping, receiptLines, receiptKey, validateCaseAndUnit, adjustmentPlan, validateVariantRole, POS_STORE_LOCATIONS };
