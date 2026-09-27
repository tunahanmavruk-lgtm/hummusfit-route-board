const LEGACY_RETAIL_ESSENTIALS = /\b(hoodie|apparel|gift card|crop hoodie|t-?shirt|sweatshirt|hat|cap)\b/i;
const LEGACY_OTHER_ESSENTIALS = /\b(spoon|fork|knife|utensil|napkin|garbage bag|trash bag|paper|plastic|cup|lid|straw|sleeve|packaging|container|glove|sanitizer|soap|towel|cleaning)\b/i;

function normalizeClassification(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function essentialsTypeFor(item) {
  const explicitClassifications = [
    ...(Array.isArray(item && item.productTags) ? item.productTags : []),
    ...(Array.isArray(item && item.productCollections)
      ? item.productCollections.flatMap((collection) =>
          typeof collection === "string"
            ? [collection]
            : [collection && collection.title, collection && collection.handle]
        )
      : []),
  ].map(normalizeClassification);

  // Shopify classification is authoritative. Exact normalized matches keep
  // ordinary drinks, snacks, and frozen items out unless merchandising has
  // explicitly placed them in an Essentials collection or added the tag.
  if (explicitClassifications.includes("retail essentials")) return "retail";
  if (explicitClassifications.includes("other essentials")) return "other";

  // Compatibility only for the small set of legacy supplies that were
  // already recognized before Shopify classification metadata was available.
  const searchable = `${item && item.title || ""} ${item && item.sku || ""}`;
  if (LEGACY_RETAIL_ESSENTIALS.test(searchable)) return "retail";
  if (LEGACY_OTHER_ESSENTIALS.test(searchable)) return "other";
  return null;
}

function stableItemKey(item) {
  return item.title + "::" + (item.sku || "");
}

function readShadowItemState(dict, item, index) {
  if (!dict) return undefined;
  const key = stableItemKey(item);
  if (Object.prototype.hasOwnProperty.call(dict, key)) return dict[key];
  return dict[index];
}

function stageForItems(record, indexedItems) {
  if (record.completedAt) return "ready";
  const closedCrates = new Set(record.closedCrates || []);
  const hasClosedEssentialCrate = indexedItems.some(({ item, index }) => {
    const crate = readShadowItemState(record.itemCrateNumber, item, index);
    return crate !== undefined && closedCrates.has(crate);
  });
  if (hasClosedEssentialCrate) return "labeled";
  const hasTouchedItem = indexedItems.some(({ item, index }) => {
    const status = readShadowItemState(record.itemStatus, item, index);
    const scanned = Number(readShadowItemState(record.itemScannedCount, item, index)) || 0;
    return Boolean(status && status !== "not_picked") || scanned > 0;
  });
  return record.pickedBy || hasTouchedItem ? "picking" : "new";
}

function progressForItems(record, indexedItems) {
  let total = 0;
  let accounted = 0;
  let hasException = false;
  indexedItems.forEach(({ item, index }) => {
    const quantity = Math.max(0, Number(item.quantity) || 0);
    const status = readShadowItemState(record.itemStatus, item, index) || "not_picked";
    total += quantity;
    if (status === "picked") accounted += quantity;
    else if (status === "partial") {
      accounted += Math.max(0, Math.min(quantity, Number(readShadowItemState(record.itemPickedQty, item, index)) || 0));
      hasException = true;
    } else if (status === "missing") {
      hasException = true;
    } else {
      accounted += Math.max(0, Math.min(quantity, Number(readShadowItemState(record.itemScannedCount, item, index)) || 0));
    }
  });
  return {
    progress: total ? Math.round((accounted / total) * 100) : 0,
    hasException,
  };
}

// Builds a derived view only. It copies every returned line and never removes,
// sorts, edits, or reassigns anything in the regular-order objects it reads.
function buildEssentialsShadow(byStopName, pickingByStop = {}, routeNameForStop = () => "") {
  const cards = [];
  Object.entries(byStopName || {}).forEach(([stopKey, order]) => {
    const indexedItems = [];
    (order.lineItems || []).forEach((item, index) => {
      const type = essentialsTypeFor(item);
      if (type) indexedItems.push({ item, index, type });
    });
    if (!indexedItems.length) return;
    const record = pickingByStop[stopKey] || {};
    const { progress, hasException } = progressForItems(record, indexedItems);
    cards.push({
      id: order.orderId || order.orderName || stopKey,
      stopKey,
      store: stopKey,
      routeName: routeNameForStop(stopKey) || "Regular route",
      regularOrderId: order.orderId,
      regularOrderName: order.orderName,
      types: [...new Set(indexedItems.map((entry) => entry.type))],
      caseCount: indexedItems.reduce((sum, entry) => sum + (Number(entry.item.quantity) || 0), 0),
      stage: stageForItems(record, indexedItems),
      progress,
      hasException,
      items: indexedItems.map(({ item, type }) => ({
        title: item.title,
        quantity: item.quantity,
        sku: item.sku || "",
        type,
      })),
    });
  });
  return cards;
}

module.exports = { buildEssentialsShadow, essentialsTypeFor };
