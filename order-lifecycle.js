function normalizeOrderTags(order) {
  return (order.tags || [])
    .concat(order.customer?.tags || [])
    .map((tag) => String(tag || "").normalize("NFKC").trim().toLowerCase())
    .filter(Boolean);
}

function hasB2BSignal(tags) {
  return tags.some((tag) =>
    /^(wholesale|b2b|out[ -]?of[ -]?state)$/.test(String(tag || "").trim().toLowerCase())
  );
}

// A ZIP can represent more than one picking stop (Brookfield and Fishkill
// share a physical drop). Never let route-definition order pick a winner.
function selectB2BStop({ orderTags, customerTags, zipCandidates, useZip, isEligible }) {
  const eligible = (keys) => [...new Set(keys || [])].filter(isEligible);
  const explicit = eligible(orderTags);
  if (explicit.length === 1) return explicit[0];
  if (explicit.length > 1) return null;

  // Preserve ambiguity even if only one candidate is currently eligible.
  // Otherwise the remaining stop could incorrectly inherit another store's order.
  const zipStops = useZip ? [...new Set(zipCandidates || [])] : [];
  if (zipStops.length === 1) return isEligible(zipStops[0]) ? zipStops[0] : null;

  const customerStops = eligible(customerTags);
  if (zipStops.length > 1) {
    const matchingCustomerStops = customerStops.filter((key) => zipStops.includes(key));
    return matchingCustomerStops.length === 1 ? matchingCustomerStops[0] : null;
  }
  return customerStops.length === 1 ? customerStops[0] : null;
}

// Shopify removes fulfilled orders from the picking feed. Keep a recent,
// completed snapshot on the delivery board until the stop is delivered.
// A new live order for the same stop always takes precedence.
const COMPLETED_BOARD_RETENTION_MS = 5 * 24 * 60 * 60 * 1000;
function mergeRecentCompletedOrders(activeByStopName, archive, validStopNames, now = Date.now()) {
  const merged = { ...activeByStopName };
  for (const [key, saved] of Object.entries(archive || {})) {
    if (merged[key] || !validStopNames.has(key) || !saved?.completedAt ||
        !saved.shopifyFulfilled || saved.deliveryComplete ||
        !saved.orderId || !Array.isArray(saved.lineItems)) continue;
    const archivedAt = Date.parse(saved.archivedAt || saved.completedAt);
    if (!Number.isFinite(archivedAt) || archivedAt > now ||
        now - archivedAt > COMPLETED_BOARD_RETENTION_MS) continue;
    merged[key] = {
      orderId: saved.orderId,
      orderName: saved.orderName,
      createdAt: saved.createdAt,
      orderCount: saved.orderCount || 1,
      orders: saved.orders || [],
      lineItems: saved.lineItems,
      isB2B: Boolean(saved.isB2B),
      retainedAfterFulfillment: true,
      shopifyFulfilled: true,
      fulfilledAt: saved.fulfilledAt || null,
    };
  }
  return merged;
}

module.exports = {
  hasB2BSignal,
  normalizeOrderTags,
  selectB2BStop,
  mergeRecentCompletedOrders,
};
