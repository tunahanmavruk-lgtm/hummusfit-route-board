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

module.exports = { remainingStopEtas };
