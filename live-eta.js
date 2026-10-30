// The first leg comes from the van's GPS and current traffic. Later legs
// preserve the dispatcher's chosen stop order and its planned drive times.
function remainingStopEtas(meta, route, stopStatus, firstLegSeconds, unloadSeconds, now = Date.now()) {
  const stopsById = new Map(route.stops.map((stop) => [stop.id, stop]));
  const remaining = meta.optimizedStopIds.filter((id) =>
    stopsById.has(id) && stopStatus[id]?.status !== "delivered"
  );
  if (!remaining.length || !Number.isFinite(firstLegSeconds) || firstLegSeconds < 0) return {};
  const result = {};
  let seconds = firstLegSeconds;
  remaining.forEach((id, index) => {
    if (index > 0) {
      const originalIndex = meta.optimizedStopIds.indexOf(id);
      seconds += unloadSeconds + (meta.legDurationsSeconds[originalIndex] || 0);
    }
    result[id] = { eta: new Date(now + seconds * 1000).toISOString(), stopsAway: index };
  });
  return result;
}

// A driver may visit stops out of the planned order. Only a confirmed visit
// to the individual stop may remove it from the live ETA calculation.
// These inferred marks stay in memory and never change delivery records.
function progressFromTripEnds(stopIds, stopStatus, tripEndsByStop, now = Date.now()) {
  let furthest = -1;
  const effectiveStatus = { ...stopStatus };
  for (let index = 0; index < stopIds.length; index++) {
    const id = stopIds[index];
    if (stopStatus[id]?.status === 'delivered' ||
        (Number.isFinite(tripEndsByStop[id]) && tripEndsByStop[id] + 10 * 60 * 1000 <= now)) {
      furthest = index;
      effectiveStatus[id] = { ...effectiveStatus[id], status: 'delivered' };
    }
  }
  return { effectiveStatus, furthest };
}

module.exports = { remainingStopEtas, progressFromTripEnds };
