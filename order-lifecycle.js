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

// "Wholesale" also covers local stores, parcel shipments and third-party
// deliveries. Only a declared out-of-state route or a configured route ZIP
// warrants an alert when the B2B stop resolver cannot find a single stop.
function hasUnmatchedB2BRouteIntent({ tags, zipCandidates, hasLocalStop }) {
  const explicitRoute = (tags || []).some((tag) =>
    /^(b2b|out[ -]?of[ -]?state)$/.test(String(tag || "").trim().toLowerCase())
  );
  return explicitRoute || (!hasLocalStop && hasB2BSignal(tags || []) &&
    [...(zipCandidates || [])].length > 0);
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

// Shopify removes fulfilled orders from the picking feed. Keep their
// snapshots until 1 PM Eastern on the calendar day after Shopify fulfillment.
// Calendar-day arithmetic avoids DST hour shifts.
const DAY_MS = 24 * 60 * 60 * 1000;
const easternCalendarFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric", month: "numeric", day: "numeric",
  weekday: "short", hour: "numeric", hourCycle: "h23",
});
function easternCalendar(timestamp) {
  const parts = Object.fromEntries(easternCalendarFormatter.formatToParts(timestamp).map((part) => [part.type, part.value]));
  return {
    day: Math.floor(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / DAY_MS),
    hour: Number(parts.hour),
  };
}

// Local orders leave the board at 1 PM Eastern on the day after they were
// placed, even if Shopify still lists them as unfulfilled. B2B orders have a
// separate delivery schedule and do not use this cutoff.
function localOrderVisible(order, now = Date.now()) {
  const createdAt = Date.parse(order?.createdAt);
  if (!Number.isFinite(createdAt) || createdAt > now) return false;
  const placed = easternCalendar(createdAt);
  const current = easternCalendar(now);
  return current.day <= placed.day ||
    (current.day === placed.day + 1 && current.hour < 13);
}

function completedOrderVisible(saved, stopMeta, now = Date.now()) {
  if (!stopMeta || !saved?.completedAt || !saved.shopifyFulfilled ||
      !saved.orderId || !Array.isArray(saved.lineItems)) return false;
  if (!stopMeta.isB2B && !localOrderVisible(saved, now)) return false;
  // Older archives predate fulfilledAt; use their archive time only as a
  // compatibility fallback, never the route's scheduled delivery day.
  const fulfilledAt = Date.parse(saved.fulfilledAt || saved.archivedAt || saved.completedAt);
  if (!Number.isFinite(fulfilledAt) || fulfilledAt > now) return false;
  const fulfilled = easternCalendar(fulfilledAt);
  const current = easternCalendar(now);
  const cleanupDay = fulfilled.day + 1;
  return current.day < cleanupDay || (current.day === cleanupDay && current.hour < 13);
}

// A new live Shopify order always takes precedence over an older snapshot.
function mergeRecentCompletedOrders(activeByStopName, archive, validStopNames, now = Date.now()) {
  const merged = { ...activeByStopName };
  for (const [key, saved] of Object.entries(archive || {})) {
    if (merged[key] || !completedOrderVisible(saved, validStopNames.get(key), now)) continue;
    merged[key] = {
      orderId: saved.orderId,
      orderName: saved.orderName,
      createdAt: saved.createdAt,
      completedAt: saved.completedAt,
      archivedAt: saved.archivedAt,
      orderCount: saved.orderCount || 1,
      orders: saved.orders || [],
      lineItems: saved.lineItems,
      isB2B: Boolean(saved.isB2B),
      retainedAfterFulfillment: true,
      shopifyFulfilled: true,
      fulfilledAt: saved.fulfilledAt || null,
      deliveryComplete: Boolean(saved.deliveryComplete),
      deliveredAt: saved.deliveredAt || null,
    };
  }
  return merged;
}

module.exports = {
  hasB2BSignal,
  hasUnmatchedB2BRouteIntent,
  normalizeOrderTags,
  selectB2BStop,
  localOrderVisible,
  completedOrderVisible,
  mergeRecentCompletedOrders,
};
