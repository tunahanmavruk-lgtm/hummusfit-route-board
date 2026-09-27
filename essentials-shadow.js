const RETAIL_ESSENTIALS = /\b(hoodie|apparel|gift card|crop hoodie|t-?shirt|sweatshirt|hat|cap|shaker|tote|retail)\b/i;
const OTHER_ESSENTIALS = /\b(spoon|fork|knife|utensil|napkin|garbage bag|trash bag|paper|plastic|cup|lid|straw|sleeve|packaging|container|glove|sanitizer|soap|towel|cleaning)\b/i;

function essentialsTypeFor(item) {
  const searchable = `${item && item.title || ""} ${item && item.sku || ""}`;
  if (RETAIL_ESSENTIALS.test(searchable)) return "retail";
  if (OTHER_ESSENTIALS.test(searchable)) return "other";
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
    const grouped = { retail: [], other: [] };
    (order.lineItems || []).forEach((item, index) => {
      const type = essentialsTypeFor(item);
      if (type) grouped[type].push({ item, index });
    });
    ["retail", "other"].forEach((type) => {
      const indexedItems = grouped[type];
      if (!indexedItems.length) return;
      const record = pickingByStop[stopKey] || {};
      const { progress, hasException } = progressForItems(record, indexedItems);
      cards.push({
        id: `${order.orderId || order.orderName || stopKey}::${type}`,
        stopKey,
        store: stopKey,
        routeName: routeNameForStop(stopKey) || "Regular route",
        regularOrderId: order.orderId,
        regularOrderName: order.orderName,
        type,
        caseCount: indexedItems.reduce((sum, entry) => sum + (Number(entry.item.quantity) || 0), 0),
        stage: stageForItems(record, indexedItems),
        progress,
        hasException,
        items: indexedItems.map(({ item }) => ({
          title: item.title,
          quantity: item.quantity,
          sku: item.sku || "",
        })),
      });
    });
  });
  return cards;
}

module.exports = { buildEssentialsShadow, essentialsTypeFor };
