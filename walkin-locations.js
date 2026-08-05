const LANES_URL = "https://ravishing-exploration-production-83e3.up.railway.app/api/lanes";
const LANES_CACHE_MS = 60 * 1000;
// Meals section is walked first on the real picking route (M1-01, e.g.
// 6-Guys Patty Melt, is the first stop), bakery/muffin bays second — this
// must match Tony's actual physical path through the fridge, not
// alphabetical or arbitrary order.
const ZONE_ORDER = ["meals", "bakery"];

function normalize(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
}

function laneSortKey(lane) {
  const m = String(lane).match(/^([A-Za-z]+)(\d+)-(\d+)$/);
  if (!m) return [lane, 0, 0];
  return [m[1], parseInt(m[2], 10), parseInt(m[3], 10)];
}

function buildIndex(rows) {
  const index = new Map();
  rows.forEach((row) => {
    const key = normalize(row.product_name);
    if (!key) return;
    if (!index.has(key)) {
      index.set(key, { zone: row.section, lanes: [] });
    }
    index.get(key).lanes.push(row.code);
  });
  index.forEach((entry) => {
    entry.lanes = Array.from(new Set(entry.lanes));
    entry.lanes.sort((a, b) => {
      const ka = laneSortKey(a);
      const kb = laneSortKey(b);
      if (ka[0] !== kb[0]) return ka[0] < kb[0] ? -1 : 1;
      if (ka[1] !== kb[1]) return ka[1] - kb[1];
      return ka[2] - kb[2];
    });
  });
  return index;
}

let lanesCache = { fetchedAt: 0, index: new Map() };

async function loadLocationIndex() {
  const now = Date.now();
  if (now - lanesCache.fetchedAt < LANES_CACHE_MS && lanesCache.index.size) {
    return lanesCache.index;
  }
  try {
    const res = await fetch(LANES_URL);
    if (!res.ok) throw new Error(`lanes endpoint returned ${res.status}`);
    const rows = await res.json();
    const index = buildIndex(rows);
    lanesCache = { fetchedAt: now, index };
    return index;
  } catch (err) {
    console.log(`Walk-in lane fetch failed (${err.message}) — ${lanesCache.index.size ? "using last known lane data" : "no lane data available yet"}.`);
    return lanesCache.index;
  }
}

// Confirmed against Tony's actual walk (8/5/2026): the pick path zigzags
// row by row within a zone instead of restarting at position 1 every row —
// M1 walked 1->27, M2 walked 27->1, M3 walked 1->27, then a fresh entry
// into the bakery zone resets to ascending: K1 1->35, K2 28->1. So within
// each zone, odd-numbered rows (1st, 3rd...) are walked ascending and
// even-numbered rows (2nd, 4th...) are walked descending, and the toggle
// restarts at row 1 for each new zone (M and K don't share the alternation).
function zigzagPosition(rowNum, posNum) {
  return rowNum % 2 === 0 ? -posNum : posNum;
}

function findLocation(index, title) {
  const key = normalize(title);
  const entry = index.get(key);
  if (!entry) return null;
  const zoneRank = ZONE_ORDER.indexOf(entry.zone);
  const laneKey = laneSortKey(entry.lanes[0]);
  return {
    zone: entry.zone,
    lanes: entry.lanes,
    laneLabel: entry.lanes.join(", "),
    sortKey: [
      zoneRank === -1 ? 999 : zoneRank,
      laneKey[0],
      laneKey[1],
      zigzagPosition(laneKey[1], laneKey[2]),
    ],
  };
}

module.exports = { loadLocationIndex, findLocation, normalize, buildIndex, ZONE_ORDER };
