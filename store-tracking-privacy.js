const AUTO_ARRIVAL_RADIUS_METERS = 250;
const AUTO_ARRIVAL_GRACE_MS = 10 * 60 * 1000;
const MAX_ROUTE_TRACKING_MS = 16 * 60 * 60 * 1000;
const MANUAL_ARRIVAL_GRACE_MS = 20 * 1000;

// These four delivery points are absent from the Census address ranges.
// Verified against the store/place listings linked below; keep them here so
// live tracking never depends on a geocoder request for these stops.
const KNOWN_DESTINATIONS = Object.freeze({
  // The King of Gains Gym: https://www.waze.com/live-map/directions/us/nj/cinnaminson/the-king-of-gains-gym-and-nutrition-center?to=place.ChIJT5WUZdZKwYkRpSptqk-yOzY
  "2501 US-130 Ste 4, Cinnaminson, NJ 08077": { lat: 40.0085681, lon: -74.9794237 },
  // Foundation Vitamins: https://www.waze.com/live-map/directions?from=place.ChIJpUGsrnR16IkRppkBrNBNU64
  "297 Boston Post Rd #14, Orange, CT 06477": { lat: 41.2665186, lon: -73.00268009 },
  // Ares Nutrition: https://wanderlog.com/place/details/13663709/ares-nutrition-mt-laurel-nj
  "4309 Dearborn Cir, Mt Laurel Township, NJ 08054": { lat: 39.968912, lon: -74.902446 },
  // Hummus Fit Ronkonkoma: https://www.waze.com/live-map/directions/us/ny/lake-ronkonkoma/hummus-fit?to=place.ChIJ2YBIUBs36IkRTB56u0BPMeU
  "200 Ronkonkoma Ave, Ronkonkoma, NY": { lat: 40.8206952, lon: -73.113406799 },
});

function knownDestination(address) {
  return KNOWN_DESTINATIONS[String(address)] || null;
}

function routeHasStarted(meta) {
  const startedAt = Date.parse(meta?.startedAt);
  return Number.isFinite(startedAt) && startedAt <= Date.now();
}

function routeHasEtaPlan(meta) {
  return routeHasStarted(meta) &&
    Array.isArray(meta.optimizedStopIds) &&
    Array.isArray(meta.legDurationsSeconds) &&
    meta.optimizedStopIds.length > 0 &&
    meta.legDurationsSeconds.length >= meta.optimizedStopIds.length;
}

function censusDestination(data, address) {
  const matches = data?.result?.addressMatches;
  if (!Array.isArray(matches) || matches.length !== 1) return null;
  const match = matches[0];
  const expectedZip = String(address).match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1];
  if (expectedZip && String(match.addressComponents?.zip) !== expectedZip) return null;
  const lat = Number(match.coordinates?.y);
  const lon = Number(match.coordinates?.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < 18 || lat > 72 || lon < -180 || lon > -60) return null;
  return { lat, lon };
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const northSouth = radians(lat2 - lat1);
  const eastWest = radians(lon2 - lon1);
  const a = Math.sin(northSouth / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(eastWest / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// A completed Bouncie trip ending at the store is a reliable arrival signal
// even when the driver forgets to press Arrived or Delivered on the board.
function firstTripEndNearStore(trips, destination, routeStartedAt) {
  const startedAt = Date.parse(routeStartedAt);
  if (!Number.isFinite(startedAt) || !destination) return null;
  let first = Infinity;
  for (const trip of trips || []) {
    const endedAt = Date.parse(trip.endTime);
    if (!Number.isFinite(endedAt) || endedAt < startedAt) continue;
    const points = trip.gps?.coordinates;
    const end = Array.isArray(points) && points[points.length - 1];
    if (!Array.isArray(end) || end.length < 2) continue;
    const [lon, lat] = end.map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (distanceMeters(lat, lon, destination.lat, destination.lon) <= AUTO_ARRIVAL_RADIUS_METERS) {
      first = Math.min(first, endedAt);
    }
  }
  return first === Infinity ? null : first;
}

function trackingCutoffAt(routeStartedAt, stopStatus = {}, tripEndAt = null) {
  const startedAt = Date.parse(routeStartedAt);
  if (!Number.isFinite(startedAt)) return null;
  let cutoff = startedAt + MAX_ROUTE_TRACKING_MS;
  const deliveredAt = Date.parse(stopStatus.deliveredAt);
  if (stopStatus.status === "delivered") {
    cutoff = Math.min(cutoff, Number.isFinite(deliveredAt) ? deliveredAt : 0);
  }
  const arrivedAt = Date.parse(stopStatus.arrivedAt);
  if (Number.isFinite(arrivedAt)) cutoff = Math.min(cutoff, arrivedAt + MANUAL_ARRIVAL_GRACE_MS);
  if (Number.isFinite(tripEndAt)) cutoff = Math.min(cutoff, tripEndAt + AUTO_ARRIVAL_GRACE_MS);
  return cutoff;
}

module.exports = { routeHasStarted, routeHasEtaPlan, knownDestination, censusDestination, firstTripEndNearStore, trackingCutoffAt };
