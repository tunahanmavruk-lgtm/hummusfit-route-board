const EASTERN_TIME_ZONE = "America/New_York";
const B2B_DELIVERY_DEPARTURE_HOUR_ET = 4;
const B2B_BOARD_CUTOFF_HOUR_ET = 20;

const easternPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: EASTERN_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
});
const easternOffsetFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: EASTERN_TIME_ZONE,
  timeZoneName: "longOffset",
});
const WEEKDAY_INDEX = new Map([
  ["Sun", 0], ["Mon", 1], ["Tue", 2], ["Wed", 3],
  ["Thu", 4], ["Fri", 5], ["Sat", 6],
]);

function easternCalendarParts(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(
    easternPartsFormatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: WEEKDAY_INDEX.get(parts.weekday),
  };
}

function easternLocalTimeToUtc(parts, hour) {
  const approximateUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour);
  const zoneName = easternOffsetFormatter
    .formatToParts(new Date(approximateUtc))
    .find((part) => part.type === "timeZoneName")?.value || "GMT-05:00";
  const match = zoneName.match(/GMT([+-])(\d{2}):(\d{2})/);
  const signedOffsetMinutes = match
    ? (match[1] === "+" ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3]))
    : -300;
  return approximateUtc - signedOffsetMinutes * 60 * 1000;
}

function addCalendarDays(parts, amount) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + amount));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
  };
}

function nextB2BBoardCutoff(referenceValue, deliveryDays) {
  const reference = new Date(referenceValue);
  const start = easternCalendarParts(reference);
  const scheduledDays = new Set((deliveryDays || []).map(Number));
  if (!start || !scheduledDays.size || !Number.isFinite(reference.getTime())) return 0;

  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = addCalendarDays(start, offset);
    if (!scheduledDays.has(candidate.weekday)) continue;
    const departure = easternLocalTimeToUtc(candidate, B2B_DELIVERY_DEPARTURE_HOUR_ET);
    if (departure <= reference.getTime()) continue;
    return easternLocalTimeToUtc(candidate, B2B_BOARD_CUTOFF_HOUR_ET);
  }
  return 0;
}

function b2bOrderExpiresAt(createdAt, deliveryDays, completedAt) {
  let expiresAt = nextB2BBoardCutoff(createdAt, deliveryDays);
  const completedMs = new Date(completedAt || 0).getTime();
  if (Number.isFinite(completedMs) && completedMs > expiresAt) {
    expiresAt = nextB2BBoardCutoff(completedAt, deliveryDays);
  }
  return expiresAt;
}

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

module.exports = {
  B2B_BOARD_CUTOFF_HOUR_ET,
  b2bOrderExpiresAt,
  hasB2BSignal,
  nextB2BBoardCutoff,
  normalizeOrderTags,
};
