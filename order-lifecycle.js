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

// Shopify removes fulfilled orders from the picking feed. Keep their
// snapshots through the delivery run, then clear yesterday's completed
// route at 3 PM Eastern. Calendar-day arithmetic avoids DST hour shifts.
const DAY_MS = 24 * 60 * 60 * 1000;
const easternCalendarFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric", month: "numeric", day: "numeric",
  weekday: "short", hour: "numeric", hourCycle: "h23",
});
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function easternCalendar(timestamp) {
  const parts = Object.fromEntries(easternCalendarFormatter.formatToParts(timestamp).map((part) => [part.type, part.value]));
  return {
    day: Math.floor(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / DAY_MS),
    weekday: WEEKDAYS.indexOf(parts.weekday),
    hour: Number(parts.hour),
  };
}

function completedOrderVisible(saved, stopMeta, now = Date.now()) {
  if (!stopMeta || !saved?.completedAt || !saved.shopifyFulfilled ||
      saved.deliveryComplete || !saved.orderId || !Array.isArray(saved.lineItems)) return false;
  const archivedAt = Date.parse(saved.archivedAt || saved.completedAt);
  if (!Number.isFinite(archivedAt) || archivedAt > now) return false;
  const picked = easternCalendar(archivedAt);
  const current = easternCalendar(now);
  const days = stopMeta.deliveryDays;
  let deliveryDay;
  if (Array.isArray(days) && days.length > 0) {
    const offsets = days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
      .map((day) => {
        const offset = (day - picked.weekday + 7) % 7;
        return offset === 0 && picked.hour >= 15 ? 7 : offset;
      });
    if (!offsets.length) return false;
    deliveryDay = picked.day + Math.min(...offsets);
  } else if (!stopMeta.isB2B) {
    // Local orders picked after the noon board change are for tomorrow.
    deliveryDay = picked.day + (picked.hour >= 12 ? 1 : 0);
  } else {
    return false;
  }
  const cleanupDay = deliveryDay + 1;
  return current.day < cleanupDay || (current.day === cleanupDay && current.hour < 15);
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
    };
  }
  return merged;
}

module.exports = {
  hasB2BSignal,
  normalizeOrderTags,
  selectB2BStop,
  completedOrderVisible,
  mergeRecentCompletedOrders,
};
