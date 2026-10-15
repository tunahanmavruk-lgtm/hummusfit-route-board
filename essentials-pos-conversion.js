const crypto = require("crypto");
const { essentialsTypeFor } = require("./essentials-shadow");
const RESTORED_MAPPINGS = require("./verified-retail-case-mappings-2026-10-12.json");

// Only catalog pairs that have been reviewed against the actual Shopify
// variants may change store inventory. The SKU suffix alone is not proof of
// a physical pack count or of which POS product should receive the units.
const VERIFIED_CASE_MAPPINGS = Object.freeze({
  // Revalidated against exact live Shopify variants, SKUs and unit barcodes.
  // Explicit entries below retain newer physical-barcode corrections.
  ...Object.fromEntries(RESTORED_MAPPINGS.map(({caseSku, ...mapping}) => [caseSku, Object.freeze(mapping)])),
  // NYB 2026-10-15: exact catalog pairs; configuration only, never an
  // incoming-stock credit. Existing verified receipt/ledger guards apply.
  // Barebells Protein Bars — 12 Bars — Soft Banana Caramel
  "HF-NYB-NOCCO-402-C12": Object.freeze({
    unitSku: "850064950021", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51322016727287",
    unitVariantId: "gid://shopify/ProductVariant/50622668964087",
    unitBarcode: "850064950021", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  // Barebells Protein Bars — 12 Bars — Banana Bread
  "HF-NYB-NOCCO-222-C12": Object.freeze({
    unitSku: "850075778454", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51322016760055",
    unitVariantId: "gid://shopify/ProductVariant/51085963100407",
    unitBarcode: "850075778454", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  // Barebells Protein Bars — 12 Bars — Brownie Batter
  "HF-NYB-NOCCO-219-C12": Object.freeze({
    unitSku: "850075778447", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51322016792823",
    unitVariantId: "gid://shopify/ProductVariant/50644958511351",
    unitBarcode: "850075778447", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  // Barebells Protein Bars — 12 Bars — Coconut Caramel Almond
  "HF-NYB-NOCCO-216-C12": Object.freeze({
    unitSku: "850064950700", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51322016825591",
    unitVariantId: "gid://shopify/ProductVariant/51085963034871",
    unitBarcode: "850064950700", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  // Barebells Protein Bars — 12 Bars — Peanut Butter & Jelly
  "HF-NYB-NOCCO-218-C12": Object.freeze({
    unitSku: "850075778270", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51322016858359",
    unitVariantId: "gid://shopify/ProductVariant/50622667620599",
    unitBarcode: "850075778270", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  // Core Power Elite 42g Protein Shakes — 12 × 14 oz Bottles — Chocolate
  "HF-NYB-FL-101-C12": Object.freeze({
    unitSku: "HF-NYB-FL-101-U1", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51322014105847",
    unitVariantId: "gid://shopify/ProductVariant/51322121683191",
    unitBarcode: "811620020633", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  // GHOST Energy — 12 × 16 oz Cans — Peach
  "HF-NYB-GHOST-118-C12": Object.freeze({
    unitSku: "HF-NYB-GHOST-118-U1", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51322014171383",
    unitVariantId: "gid://shopify/ProductVariant/51322123616503",
    unitBarcode: "810128529853", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  // Quest Tortilla Style Protein Chips — 8 Bags — Salsa Verde
  "HF-NYB-QUEST3106-C8": Object.freeze({
    unitSku: "888849016136", unitsPerCase: 8,
    caseVariantId: "gid://shopify/ProductVariant/51322014040311",
    unitVariantId: "gid://shopify/ProductVariant/50344585986295",
    unitBarcode: "888849016136", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  // Single-bar UPCs independently verified against distributor/retailer
  // catalogs; manufacturer and retailer distinguish the 12-bar display box.
  "HF-BUILT-SOURPUFF-GREENAPPLE-CS12": Object.freeze({
    unitSku: "840229306558", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51317893366007",
    unitVariantId: "gid://shopify/ProductVariant/51317895364855",
    unitBarcode: "840229306558", lookupByVariantId: true,
    requirePosSellUnitTag: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-BUILT-SOURPUFF-PINKLEMONADE-CS12": Object.freeze({
    // Preserve the existing internal SKU; it is NOT the scannable UPC.
    // 840229306800 is a four-pack code, not an individual wrapper barcode.
    unitSku: "840229306800", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51317893398775",
    unitVariantId: "gid://shopify/ProductVariant/51317895397623",
    unitBarcode: "840229306794", lookupByVariantId: true,
    requirePosSellUnitTag: true,
    allowSharedProductMappingPendingTag: true,
  }),
  // Exact single-bag variants and UPCs verified in the connected catalog and
  // manufacturer's listings. One display case contains 12 retail bags.
  "HF-SOURSTRIPS-LEMONBERRY-CS12": Object.freeze({
    unitSku: "860004712527", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51317893234935",
    unitVariantId: "gid://shopify/ProductVariant/51317895069943",
    unitBarcode: "860004712527", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-SOURSTRIPS-APPLEBERRY-CS12": Object.freeze({
    unitSku: "860001800593", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51317893267703",
    unitVariantId: "gid://shopify/ProductVariant/50348807389431",
    unitBarcode: "860001800593", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-SOURSTRIPS-GREENAPPLE-CS12": Object.freeze({
    unitSku: "860001800548", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51317893300471",
    unitVariantId: "gid://shopify/ProductVariant/50348807323895",
    unitBarcode: "860001800548", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-SOURSTRIPS-STRAWBERRY-CS12": Object.freeze({
    unitSku: "860001800517", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51317893333239",
    unitVariantId: "gid://shopify/ProductVariant/50348807422199",
    unitBarcode: "860001800517", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "GLOBAL GT628007-CS6": Object.freeze({
    unitSku: "SS-8801094000455", unitsPerCase: 6,
    caseVariantId: "gid://shopify/ProductVariant/51304197357815",
    unitVariantId: "gid://shopify/ProductVariant/51259495874807",
    unitBarcode: "8801094000455",
    requirePosSellUnitTag: true,
    // Exact live pair verified 2026-10-14. Catalog availability stays unchanged.
    lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-NYB-CELSIUS-141-C12": Object.freeze({
    unitSku: "889392002379", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51259609678071",
    unitVariantId: "gid://shopify/ProductVariant/50500192633079",
    unitBarcode: "889392002379",
    // The six CELSIUS flavors share one case product and its product-level
    // mapping-pending tag. Approve only this exact variant; the other five
    // flavors still have no case mapping and remain blocked.
    allowSharedProductMappingPendingTag: true,
  }),
  "MOODZ-STRAWBERRY-CS10": Object.freeze({
    unitSku: "MOODZ-STRAWBERRY-EA", unitsPerCase: 10,
    caseVariantId: "gid://shopify/ProductVariant/51284140654839",
    unitVariantId: "gid://shopify/ProductVariant/51284140785911",
    unitBarcode: "850075436248",
    requirePosSellUnitTag: true,
  }),
  "HF-NYB-CELL-4909-C12": Object.freeze({
    unitSku: "842595141467", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51259609546999",
    unitVariantId: "gid://shopify/ProductVariant/51279794733303",
    unitBarcode: "842595141467",
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-NYB-CELSIUS-131-C12": Object.freeze({
    unitSku: "889392001563", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51259609809143",
    unitVariantId: "gid://shopify/ProductVariant/51279794667767",
    unitBarcode: "889392001563",
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-NYB-CELSIUS-1004-C12": Object.freeze({
    unitSku: "889392000320", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51259609841911",
    unitVariantId: "gid://shopify/ProductVariant/51279794700535",
    unitBarcode: "889392000320",
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-NYB-GHOST-1000-C12": Object.freeze({
    unitSku: "GHOST-YOOHOO-11OZ-EA", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51259609940215",
    unitVariantId: "gid://shopify/ProductVariant/51280871325943",
    // Verified against the physical Yoo-hoo can photographed at Ronkonkoma.
    unitBarcode: "810169606353",
    requirePosSellUnitTag: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "MOODZ-BERRY-CS10": Object.freeze({
    unitSku: "MOODZ-BERRY-EA", unitsPerCase: 10,
    caseVariantId: "gid://shopify/ProductVariant/51284140753143",
    unitVariantId: "gid://shopify/ProductVariant/51284140884215",
    unitBarcode: "850075436262",
    requirePosSellUnitTag: true,
  }),
  "PS-075720000814-CS48": Object.freeze({
    unitSku: "075720000814", unitsPerCase: 48,
    caseVariantId: "gid://shopify/ProductVariant/50514177261815",
    unitVariantId: "gid://shopify/ProductVariant/50301570744567",
    unitBarcode: "075720000814",
  }),
  "HF-NYB-QUEST3100-C8": Object.freeze({
    unitSku: "888849006649", unitsPerCase: 8,
    caseVariantId: "gid://shopify/ProductVariant/51259610235127",
    unitVariantId: "gid://shopify/ProductVariant/50344585953527",
    unitBarcode: "888849006649",
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-NYB-QUEST3104-C8": Object.freeze({
    unitSku: "888849011063", unitsPerCase: 8,
    caseVariantId: "gid://shopify/ProductVariant/51259610267895",
    unitVariantId: "gid://shopify/ProductVariant/50344586019063",
    unitBarcode: "888849011063",
    allowSharedProductMappingPendingTag: true,
  }),
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
    unitSku: "860014183430", unitsPerCase: 8,
    caseVariantId: "gid://shopify/ProductVariant/51242444226807",
    unitVariantId: "gid://shopify/ProductVariant/51259503444215",
    unitBarcode: "860014183430",
    requirePosSellUnitTag: true,
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
    if(status==='missing' && scanned===0 && receivedCases===0) {
      return {...caseMapping(item),title:item.title,pickedCases:0,receivedCases:0,index};
    }
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
  if (caseItem.mappingPending && !line.allowSharedProductMappingPendingTag) {
    throw new Error("Case-to-unit mapping is still pending catalog verification");
  }
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

module.exports = { caseMapping, receiptLines, receiptKey, validateCaseAndUnit, adjustmentPlan, POS_STORE_LOCATIONS };
