const crypto = require("crypto");
const { essentialsTypeFor } = require("./essentials-shadow");

const VERIFIED_UNIT_SKU_OVERRIDES = Object.freeze({
  // The imported Coca-Cola case has an SS- distributor prefix that is NOT
  // present on the individual POS variant; this was verified in Shopify.
  "SS-4890008101306-CS8": "4890008101306",
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

// The case SKU must explicitly identify its sell-unit SKU and pack size.
// Never infer a pack size from a title: merchandising titles are not stock data.
function caseMapping(item) {
  if (essentialsTypeFor(item) !== "retail") return null;
  const caseSku = String(item.sku || "").trim();
  const match = caseSku.match(/^(.+)-CS([1-9]\d*)$/i);
  if (!match) return { caseSku, error: "Case SKU needs a verified -CS<count> mapping" };
  const unitsPerCase = Number(match[2]);
  if (!Number.isSafeInteger(unitsPerCase) || unitsPerCase > 1000) {
    return { caseSku, error: "Invalid units-per-case mapping" };
  }
  return { caseSku, unitSku: VERIFIED_UNIT_SKU_OVERRIDES[caseSku] || match[1], unitsPerCase };
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
  const allowed = new Set(retail.map((item) => item.sku));
  for (const sku of Object.keys(receivedCounts)) {
    if (!allowed.has(sku)) throw new Error(`Unexpected receipt SKU: ${sku}`);
  }
  return retail.map((item, index) => {
    const workflowIndex = (order.lineItems || []).filter((entry) => essentialsTypeFor(entry)).indexOf(item);
    const status = readItemState(essentialsRecord.itemStatus, item, workflowIndex);
    const scanned = Number(readItemState(essentialsRecord.itemScannedCount, item, workflowIndex)) || 0;
    const receivedCases = Number(receivedCounts[item.sku]);
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

function adjustmentPlan(line, caseItem, unitItem, locationId, key) {
  if (caseItem.available < line.receivedCases) throw new Error("Case stock has not arrived at this Shopify location");
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

module.exports = { caseMapping, receiptLines, receiptKey, adjustmentPlan, POS_STORE_LOCATIONS };
