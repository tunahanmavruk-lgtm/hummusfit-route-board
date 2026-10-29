// A route may start without a driver tap only after the assigned van has
// actually been seen at HQ and then outside the HQ area on fresh GPS fixes.
// Keep this observation in memory: after a restart, an already-away van must
// never be mistaken for a new departure.
const HQ_POSITION = { lat: 40.8130, lon: -73.1654 };
const INSIDE_HQ_METERS = 300;
const DEPARTED_HQ_METERS = 650;
const FRESH_FIX_MS = 5 * 60 * 1000;
const MAX_DEPARTURE_MS = 60 * 60 * 1000;

function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function observation(vehicle, now = Date.now()) {
  const at = Date.parse(vehicle?.stats?.lastUpdated);
  const lat = Number(vehicle?.stats?.location?.lat);
  const lon = Number(vehicle?.stats?.location?.lon);
  if (!Number.isFinite(at) || at > now + 60 * 1000 || now - at > FRESH_FIX_MS ||
      !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 ||
      Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null;
  return { at, position: { lat, lon }, speed: Number(vehicle.stats.speed) || 0,
    isRunning: vehicle.stats.isRunning === true };
}

function createDepartureDetector() {
  const byImei = new Map();
  return (vehicle, now = Date.now()) => {
    const imei = String(vehicle?.imei || "");
    const fix = observation(vehicle, now);
    if (!imei || !fix) return null;
    const prior = byImei.get(imei) || {};
    // A repeated cached Bouncie fix is not a second movement observation.
    if (fix.at <= (prior.lastFixAt || 0)) return null;
    const meters = distanceMeters(HQ_POSITION, fix.position);
    if (meters <= INSIDE_HQ_METERS) {
      byImei.set(imei, { lastFixAt: fix.at, insideAt: fix.at, usedInsideAt: prior.usedInsideAt });
      return null;
    }
    byImei.set(imei, { ...prior, lastFixAt: fix.at });
    if (meters < DEPARTED_HQ_METERS || !fix.isRunning || fix.speed < 5 ||
        !prior.insideAt || prior.insideAt === prior.usedInsideAt ||
        fix.at - prior.insideAt > MAX_DEPARTURE_MS) return null;
    byImei.set(imei, { ...prior, lastFixAt: fix.at, usedInsideAt: prior.insideAt });
    return { imei, departedAt: new Date(fix.at).toISOString() };
  };
}

function routeForDeparture(routes, state, ordersByStop, imei, vehicleIds, todayDow, easternHour) {
  if (easternHour < 3 || easternHour >= 15) return null;
  const matches = routes.filter((route) => {
    if (route.day !== undefined && route.day !== todayDow) return false;
    if (route.day === undefined && easternHour >= 12) return false;
    const van = state.assignments?.[route.id]?.van;
    if (!van || String(vehicleIds[van]) !== imei || state.routeMeta?.[route.id]?.startedAt) return false;
    return route.stops.some((stop) => {
      const order = ordersByStop[stop.name.toLowerCase()];
      return order && !stop.isServiceStop && Boolean(order.isB2B) === (route.day !== undefined);
    });
  });
  if (matches.length === 1) return matches[0];
  // Route #2 uses Route #1's van after it returns to HQ. Each leg needs
  // its own observed departure; the detector consumes the first event.
  if (matches.length === 2 && matches.every((route) => ["r1", "r2"].includes(route.id))) {
    return matches.find((route) => route.id === "r1");
  }
  // A van assigned to two otherwise unrelated routes is ambiguous. Never
  // publish tracking for the wrong set of customers.
  return null;
}

module.exports = { HQ_POSITION, distanceMeters, observation, createDepartureDetector, routeForDeparture };
