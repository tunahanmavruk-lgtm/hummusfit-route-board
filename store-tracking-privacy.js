const AUTO_ARRIVAL_RADIUS_METERS = 250;
const AUTO_ARRIVAL_GRACE_MS = 10 * 60 * 1000;
const MAX_ROUTE_TRACKING_MS = 16 * 60 * 60 * 1000;
const MANUAL_ARRIVAL_GRACE_MS = 20 * 1000;

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

module.exports = { firstTripEndNearStore, trackingCutoffAt };
