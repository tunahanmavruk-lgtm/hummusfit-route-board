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

// A later confirmed stop visit proves the van has passed earlier listed
// stops even when the driver forgot to mark them delivered on the board.
// These inferred marks are only used for ETA/privacy calculations; they
// never write delivery status or touch an order.
function progressFromTripEnds(stopIds, stopStatus, tripEndsByStop, now = Date.now()) {
  let furthest = -1;
  for (let index = 0; index < stopIds.length; index++) {
    const id = stopIds[index];
    if (stopStatus[id]?.status === 'delivered' ||
        (Number.isFinite(tripEndsByStop[id]) && tripEndsByStop[id] + 10 * 60 * 1000 <= now)) {
      furthest = index;
    }
  }
  const effectiveStatus = { ...stopStatus };
  for (let index = 0; index <= furthest; index++) {
    effectiveStatus[stopIds[index]] = { ...effectiveStatus[stopIds[index]], status: 'delivered' };
  }
  return { effectiveStatus, furthest };
}

module.exports = { remainingStopEtas, progressFromTripEnds };
