const express = require("express");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");

// Finds the largest font size (within a min/max range) that still fits
// the given text on a single line at the specified width — used so a
// short store name like "Islip" renders huge, while a longer one like
// "Lindenhurst" automatically steps down just enough to still fit on
// one line, without ever looking cramped or wrapping awkwardly.
function fitTextFontSize(doc, text, maxWidth, maxSize, minSize) {
  doc.font("Helvetica-Bold");
  let size = maxSize;
  doc.fontSize(size);
  while (size > minSize && doc.widthOfString(text) > maxWidth) {
    size -= 2;
    doc.fontSize(size);
  }
  return size;
}

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, "data.json");

app.use(express.json());

// ================= ROUTE DEFINITIONS =================
const HQ = {
  name: "Hummus Fit New HQ",
  address: "1800 Motor Pkwy, Islandia, NY 11749",
};

const ROUTES = [
  {
    id: "r1",
    name: "Route #1",
    time: "4:00 AM",
    vanSize: "Large (350)",
    stops: [
      { id: "r1-1", name: "Lindenhurst", address: "38 E Sunrise Hwy, Lindenhurst, NY" },
      { id: "r1-2", name: "Lynbrook", address: "433 Sunrise Highway, Lynbrook, NY" },
      { id: "r1-3", name: "Island Park", address: "4587 Austin Blvd, Island Park, NY" },
      { id: "r1-4", name: "Bellmore", address: "2060 Bellmore Ave, Bellmore, NY" },
    ],
  },
  {
    id: "r2",
    name: "Route #2",
    time: "7:30 AM",
    vanSize: "Large (350)",
    stops: [
      { id: "r2-1", name: "Islip", address: "14 E Main St, East Islip, NY" },
      { id: "r2-2", name: "Farmingdale", address: "101 Fulton Street, Farmingdale, NY" },
      { id: "r2-3", name: "Deer Park", address: "550 Commack Road, Unit B, Deer Park, NY" },
    ],
  },
  {
    id: "r3",
    name: "Route #3",
    time: "9:00 AM",
    vanSize: "Small",
    stops: [
      { id: "r3-1", name: "Woodbury", address: "150 Woodbury Road, Woodbury, NY" },
      { id: "r3-2", name: "Huntington", address: "281 Walt Whitman Road, Huntington Station, NY" },
      { id: "r3-3", name: "Ozone Park", brand: "Natural Body", address: "135-26 Crossbay Blvd, Ozone Park, NY 11417", deliveryDays: [1, 3, 5] },
      { id: "r3-4", name: "Hicksville", brand: "Natural Body", address: "1040 Hicksville Rd, Hicksville, NY 11801", deliveryDays: [1, 3, 5] },
    ],
  },
  {
    id: "r4",
    name: "Route #4",
    time: "8:00 AM",
    vanSize: "Any",
    stops: [
      { id: "r4-1", name: "Selden", address: "680 Middle Country Rd, Selden, NY" },
      { id: "r4-2", name: "Miller Place", address: "451 Route 25A, Miller Place, NY" },
      { id: "r4-3", name: "Lake Grove", address: "2810 Middle Country Rd, Lake Grove, NY" },
    ],
  },
  {
    id: "r5",
    name: "Route #5",
    time: "8:00 AM",
    vanSize: "Any",
    stops: [
      { id: "r5-1", name: "Holbrook", address: "1066 Main Street, Holbrook, NY" },
      { id: "r5-2", name: "Ronkonkoma", address: "200 Ronkonkoma Ave, Ronkonkoma, NY" },
    ],
  },
];

// The only tags that should ever be treated as a delivery stop are ones
// that match a real stop name from the routes above. Without this check,
// ANY customer tag (marketing tags, campaign names, dates, whatever else
// gets tagged on a customer for unrelated reasons) would incorrectly show
// up as a "stop" with a lit order pill.
//
// This is a Map (not just a Set) so each valid stop can also carry
// metadata — right now just whether it's an out-of-state/B2B stop, which
// the picking screen uses to flip into a completely different visual
// theme so pickers can't mistake one for a local order.
const VALID_STOP_NAMES = new Map(
  ROUTES.flatMap((route) =>
    route.stops.map((s) => [
      s.name.toLowerCase(),
      { isB2B: Boolean(s.isB2B), deliveryDays: s.deliveryDays || null },
    ])
  )
);

function isStopScheduledToday(stopMeta, now = new Date()) {
  if (!stopMeta || !stopMeta.deliveryDays) return true; // no schedule set = every day
  return stopMeta.deliveryDays.includes(getEasternWeekday(now));
}

const FLEET = [
  "2022 RAM Promaster 1500",
  "2016 FORD Transit",
  "Small Diesel 2 — Mercedes Sprinter",
  "Mercedes Big Muffin — Sprinter",
  "Mercedes Small 3 — Sprinter",
  "Buffin Tow Truck — Sprinter",
  "Transit 350 (1)",
  "Big White — Sprinter",
  "Ford Transit 3",
  "Darian — Ford Transit",
];

const DRIVERS = [
  "Chavez, Richy C",
  "Flores Morales, Carlos E",
  "Hermosa Melendez, Edson D",
  "Kaba, Berke",
  "Soto, Daniel U",
  "Tanglay, Serol",
  "Hazar Kutuk",
  "Ali Dumez",
];

// Warehouse/fridge crew who do the actual picking — using the same
// roster as drivers as a starting default until the real picking crew
// names are provided (swap this list once we have it, same pattern).
const PICKERS = [
  "Chavez, Richy C",
  "Flores Morales, Carlos E",
  "Hermosa Melendez, Edson D",
  "Kaba, Berke",
  "Soto, Daniel U",
  "Tanglay, Serol",
  "Hazar Kutuk",
  "Ali Dumez",
];

const FLEET_TRACKER_URL = "https://hummusfit-fleet-tracker-production.up.railway.app";

// How long a driver realistically needs to unload at each stop before
// continuing to the next one — used to make ETAs actually accurate
// instead of just chaining raw drive times back to back. Adjust here if
// 18 minutes isn't the right number for your stops.
const UNLOAD_MINUTES_PER_STOP = 18;

// ================= DAY / STATE PERSISTENCE =================
function todayEastern() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// 0=Sunday, 1=Monday ... 6=Saturday, matching JS Date.getDay() convention,
// but computed in Eastern time regardless of what timezone the server
// itself runs in.
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function getEasternWeekday(now = new Date()) {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(now);
  return WEEKDAY_NAMES.indexOf(short);
}

function getStartOfDayEastern(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = fmt.formatToParts(now).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  const hour = parseInt(parts.hour, 10) % 24;
  const ms =
    (hour * 3600 + parseInt(parts.minute, 10) * 60 + parseInt(parts.second, 10)) *
      1000 +
    now.getMilliseconds();
  return new Date(now.getTime() - ms);
}

// Stores order 12:00 PM – 11:00 PM Eastern for NEXT-DAY delivery.
// The relevant window depends on what time it is right now:
//   - Before noon ET  -> yesterday's 12pm-11pm window (routes running
//     THIS morning are fulfilling those orders)
//   - Noon or later    -> today's 12pm-11pm window, live, as tomorrow's
//     orders come in
// This guarantees the board never shows orders from any day other than
// the single, currently-relevant order window — no stale multi-day
// leftovers.
const HOUR_MS = 3600 * 1000;
function getOrderWindowEastern(now = new Date()) {
  const startOfTodayET = getStartOfDayEastern(now);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    hour: "2-digit",
  });
  const hour = parseInt(fmt.format(now), 10) % 24;

  let windowStart, windowEnd;
  if (hour >= 12) {
    windowStart = new Date(startOfTodayET.getTime() + 12 * HOUR_MS);
    windowEnd = new Date(startOfTodayET.getTime() + 23 * HOUR_MS);
  } else {
    windowStart = new Date(startOfTodayET.getTime() - 12 * HOUR_MS);
    windowEnd = new Date(startOfTodayET.getTime() - 1 * HOUR_MS);
  }
  return { windowStart, windowEnd, isOpen: now >= windowStart && now <= windowEnd };
}

function defaultState() {
  return { day: todayEastern(), assignments: {}, stopStatus: {}, routeMeta: {}, picking: {} };
}

function loadState() {
  try {
    const state = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (state.day !== todayEastern()) {
      return defaultState();
    }
    if (!state.routeMeta) state.routeMeta = {}; // migrate older saved state
    if (!state.picking) state.picking = {}; // migrate older saved state
    return state;
  } catch (e) {
    return defaultState();
  }
}
function saveState(state) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

app.get("/api/routes", (req, res) => {
  res.json({ routes: ROUTES, fleet: FLEET, drivers: DRIVERS, hq: HQ });
});
app.get("/api/state", (req, res) => {
  res.json(loadState());
});
app.post("/api/assign", (req, res) => {
  const { routeId, van, driver } = req.body;
  if (!routeId) return res.status(400).json({ error: "routeId required" });
  const state = loadState();
  state.assignments[routeId] = {
    van: van ?? state.assignments[routeId]?.van ?? "",
    driver: driver ?? state.assignments[routeId]?.driver ?? "",
  };
  saveState(state);
  res.json({ ok: true, state });
});
app.post("/api/stop-status", (req, res) => {
  const { stopId, status } = req.body;
  if (!stopId || !status) return res.status(400).json({ error: "stopId and status required" });
  const state = loadState();
  const now = new Date().toISOString();
  const existing = state.stopStatus[stopId] || {};
  const updated = { ...existing, status };
  if (status === "picked" && !existing.pickedAt) updated.pickedAt = now;
  if (status === "arrived" && !existing.arrivedAt) updated.arrivedAt = now;
  if (status === "delivered" && !existing.deliveredAt) updated.deliveredAt = now;
  if (status === "not_started") {
    // starting over on this stop — clear timestamps
    updated.pickedAt = null;
    updated.arrivedAt = null;
    updated.deliveredAt = null;
  }
  state.stopStatus[stopId] = updated;
  saveState(state);
  res.json({ ok: true, state });
});

app.post("/api/stop-issue", (req, res) => {
  const { stopId, issue } = req.body;
  if (!stopId) return res.status(400).json({ error: "stopId required" });
  const state = loadState();
  const existing = state.stopStatus[stopId] || { status: "not_started" };
  state.stopStatus[stopId] = { ...existing, issue: Boolean(issue) };
  saveState(state);
  res.json({ ok: true, state });
});

app.post("/api/reset-day", (req, res) => {
  const state = defaultState();
  saveState(state);
  res.json({ ok: true, state });
});

// ================= SHOPIFY — TODAY'S ORDERS BY STOP TAG =================
const SHOP_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const API_VERSION = "2025-01";

async function shopifyGraphQL(query, variables) {
  if (!SHOP_DOMAIN || !SHOPIFY_TOKEN) {
    throw new Error("Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN");
  }
  const res = await fetch(`https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (!res.ok || data.errors) {
    throw new Error(`Shopify API error: ${JSON.stringify(data.errors || data)}`);
  }
  return data.data;
}

// In-memory cache, refreshed on demand (not every request)
let ordersCache = { fetchedAt: 0, byStopName: {}, windowStart: null, windowEnd: null };
const ORDERS_CACHE_MS = 60 * 1000; // 1 minute

async function fetchTodaysStopOrders() {
  const now = Date.now();
  if (now - ordersCache.fetchedAt < ORDERS_CACHE_MS) {
    return ordersCache;
  }

  const { windowStart, windowEnd } = getOrderWindowEastern(new Date());
  const isoStart = windowStart.toISOString();
  // Cap the end bound at "now" if the window is still in progress today,
  // otherwise use the fixed 11pm cutoff — either way this is a hard upper
  // bound, so orders from outside the current window can never appear.
  const cappedEnd = new Date(Math.min(windowEnd.getTime(), now));
  const isoEnd = cappedEnd.toISOString();

  let orders = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const query = `
      query($cursor: String, $queryString: String!) {
        orders(first: 50, after: $cursor, query: $queryString) {
          edges {
            cursor
            node {
              id
              name
              createdAt
              customer { tags }
              lineItems(first: 50) {
                edges { node { title quantity sku } }
              }
            }
          }
          pageInfo { hasNextPage }
        }
      }
    `;
    const data = await shopifyGraphQL(query, {
      cursor,
      queryString: `created_at:>='${isoStart}' created_at:<='${isoEnd}' status:any`,
    });

    const edges = data.orders.edges;
    orders = orders.concat(edges.map((e) => e.node));
    hasNextPage = data.orders.pageInfo.hasNextPage;
    cursor = edges.length ? edges[edges.length - 1].cursor : null;
    if (!edges.length) break;
  }

  const byStopName = {};
  orders.forEach((order) => {
    const tags = (order.customer?.tags || []).map((t) => t.trim());
    tags.forEach((tag) => {
      const key = tag.toLowerCase();
      // Only ever match a tag that's an actual real stop name from our
      // routes — ignore any other tag on the customer (marketing tags,
      // campaign names, unrelated labels, etc.)
      const stopMeta = VALID_STOP_NAMES.get(key);
      if (!stopMeta) return;
      // First matching order per stop name wins (most recent order stays if duplicates)
      if (!byStopName[key]) {
        byStopName[key] = {
          orderId: order.id,
          orderName: order.name,
          createdAt: order.createdAt,
          lineItems: order.lineItems.edges.map((e) => e.node),
          isB2B: stopMeta.isB2B,
        };
      }
    });
  });

  ordersCache = { fetchedAt: now, byStopName, windowStart, windowEnd };
  return ordersCache;
}

app.get("/api/today-orders", async (req, res) => {
  const now = new Date();
  const scheduledToday = {};
  VALID_STOP_NAMES.forEach((meta, key) => {
    scheduledToday[key] = isStopScheduledToday(meta, now);
  });
  try {
    const cache = await fetchTodaysStopOrders();
    res.json({
      byStopName: cache.byStopName,
      windowStart: cache.windowStart,
      windowEnd: cache.windowEnd,
      scheduledToday,
      configured: Boolean(SHOP_DOMAIN && SHOPIFY_TOKEN),
    });
  } catch (err) {
    res.json({ byStopName: {}, scheduledToday, configured: false, error: err.message });
  }
});

// ================= PACKING SLIP PDF =================
app.get("/api/packing-slip/:stopName", async (req, res) => {
  try {
    const cache = await fetchTodaysStopOrders();
    const key = decodeURIComponent(req.params.stopName).toLowerCase();
    const order = cache.byStopName[key];
    if (!order) {
      return res.status(404).send("No order found for this stop in the current order window.");
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${order.orderName}-packing-slip.pdf"`);

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    const checkboxX = 50;
    const qtyX = 105;
    const itemX = 150;
    const itemWidth = 375;
    const boxSize = 14;
    const BRAND_ORANGE = "#E8612C";
    const INK_DARK = "#222222";
    const ZEBRA_TINT = "#F3F3F1";

    // Reliable, fixed-height column header — draws all three labels at
    // the exact same y-coordinate (never relies on doc.y auto-advancing
    // inconsistently between calls), then explicitly sets doc.y for the
    // divider line so it always sits cleanly below the text with no
    // chance of the line crossing through the letters.
    function drawColumnHeaders() {
      const headerY = doc.y;
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#8A8580");
      doc.text("PICKED", checkboxX, headerY, { width: 50, lineBreak: false });
      doc.text("QTY", qtyX, headerY, { width: 35, lineBreak: false });
      doc.text("ITEM", itemX, headerY, { lineBreak: false });
      doc.y = headerY + 16;
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(INK_DARK).lineWidth(1).stroke();
      doc.y += 10;
    }

    const pageUsableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const stopNameUpper = req.params.stopName.toUpperCase();

    // Full-bleed brand-orange header band — this is what makes the slip
    // feel like Hummus Fit instead of a generic warehouse form.
    const BAND_HEIGHT = 150;
    doc.rect(0, 0, doc.page.width, BAND_HEIGHT).fill(BRAND_ORANGE);
    doc.font("Helvetica-Bold").fontSize(18).fillColor("#FFFFFF")
      .text("HUMMUS FIT", 50, 34, { width: pageUsableWidth });
    const stopFontSize = fitTextFontSize(doc, stopNameUpper, pageUsableWidth, 60, 32);
    doc.font("Helvetica-Bold").fontSize(stopFontSize).fillColor("#FFFFFF")
      .text(stopNameUpper, 50, 62, { width: pageUsableWidth });

    doc.y = BAND_HEIGHT + 26;
    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK_DARK).text("PACKING SLIP", { align: "left" });
    doc.moveDown(0.6);

    doc.font("Helvetica-Bold").fontSize(13).fillColor("#111111").text(`Order: ${order.orderName}`);
    doc.font("Helvetica").fontSize(10).fillColor("#666666").text(`Date: ${new Date(order.createdAt).toLocaleString("en-US", { timeZone: "America/New_York" })}`);
    doc.moveDown(1);

    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#dddddd").stroke();
    doc.moveDown(0.7);
    drawColumnHeaders();

    const pageBottom = doc.page.height - doc.page.margins.bottom;

    order.lineItems.forEach((item, idx) => {
      const textHeight = doc.heightOfString(item.title, { width: itemWidth, fontSize: 11 });
      const estimatedRowHeight = Math.max(boxSize + 8, textHeight + 8);

      // If this row won't fit before the bottom margin, start a fresh page
      // and repeat the column headers so the sheet stays readable no
      // matter how long the order is.
      if (doc.y + estimatedRowHeight > pageBottom) {
        doc.addPage();
        doc.y = 50;
        drawColumnHeaders();
      }

      const rowY = doc.y;

      // Alternate a light teal tint behind every other row — same idea as
      // before, just recolored to match the brand instead of plain gray
      if (idx % 2 === 1) {
        doc.rect(46, rowY - 3, 503, estimatedRowHeight).fill(ZEBRA_TINT);
      }

      // Draw an actual empty checkbox square to physically check off by hand
      doc
        .rect(checkboxX, rowY, boxSize, boxSize)
        .lineWidth(1.4)
        .strokeColor(INK_DARK)
        .stroke();

      doc.fontSize(11).fillColor("#111111");
      doc.text(String(item.quantity), qtyX, rowY + 1, { width: 35 });
      doc.text(item.title, itemX, rowY + 1, { width: itemWidth });

      // Advance past the taller of (checkbox height, wrapped text height)
      const afterTextY = doc.y;
      const rowHeight = Math.max(boxSize + 6, afterTextY - rowY + 6);
      doc.y = rowY + rowHeight;
    });

    // Make sure the footer line itself doesn't get cut off at the bottom
    if (doc.y + 40 > pageBottom) {
      doc.addPage();
      doc.y = 50;
    }

    doc.moveDown(0.8);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#dddddd").stroke();
    doc.moveDown(0.5);

    const totalItems = order.lineItems.reduce((sum, i) => sum + i.quantity, 0);
    doc.fontSize(10).fillColor("#666666").text(`Total items: ${totalItems}`);

    doc.end();
  } catch (err) {
    res.status(500).send("Error generating packing slip: " + err.message);
  }
});

// ================= DIGITAL PICKING SYSTEM =================
// Lets the warehouse/fridge crew pick each order on an iPhone/iPad
// instead of (or alongside) the printed paper slip, and generates a
// separate "Missing Items" report for anything that couldn't be found.

function pickingKeyFor(stopName) {
  return stopName.toLowerCase();
}

function getPickingRecord(state, stopName, order) {
  const key = pickingKeyFor(stopName);
  if (!state.picking[key] || state.picking[key].orderId !== order.orderId) {
    // fresh order for this stop (or first time seeing it today) — seed it
    state.picking[key] = {
      orderId: order.orderId,
      orderName: order.orderName,
      itemStatus: {}, // index -> 'not_picked' | 'picked' | 'missing'
      itemNotes: {}, // index -> free text reason
      pickedBy: null, // employee name working this order
      completedAt: null, // set once Finish Order succeeds
      completedBy: null,
    };
  }
  return state.picking[key];
}

// List every stop that has an order in the current window, with picking
// progress, so the crew can see what's left to do at a glance.
app.get("/api/picking-list", async (req, res) => {
  try {
    const cache = await fetchTodaysStopOrders();
    const state = loadState();
    const list = Object.entries(cache.byStopName).map(([key, order]) => {
      const record = getPickingRecord(state, key, order);
      const statuses = Object.values(record.itemStatus);
      const pickedCount = statuses.filter((s) => s === "picked").length;
      const missingCount = statuses.filter((s) => s === "missing").length;
      const totalItems = order.lineItems.length;
      return {
        stopName: key,
        orderName: order.orderName,
        orderId: order.orderId,
        totalItems,
        pickedCount,
        missingCount,
        isComplete: Boolean(record.completedAt),
        isB2B: Boolean(order.isB2B),
        pickedBy: record.pickedBy,
        completedAt: record.completedAt,
      };
    });
    saveState(state); // persist any freshly-seeded records
    res.json({ stops: list, configured: Boolean(SHOP_DOMAIN && SHOPIFY_TOKEN) });
  } catch (err) {
    res.json({ stops: [], configured: false, error: err.message });
  }
});

// Full detail for one stop's order — line items plus current pick status
app.get("/api/picking-order/:stopName", async (req, res) => {
  try {
    const cache = await fetchTodaysStopOrders();
    const key = pickingKeyFor(decodeURIComponent(req.params.stopName));
    const order = cache.byStopName[key];
    if (!order) return res.status(404).json({ error: "No order found for this stop." });

    const state = loadState();
    const record = getPickingRecord(state, key, order);
    saveState(state);

    res.json({
      stopName: key,
      orderName: order.orderName,
      orderId: order.orderId,
      createdAt: order.createdAt,
      lineItems: order.lineItems,
      itemStatus: record.itemStatus,
      itemNotes: record.itemNotes,
      isB2B: Boolean(order.isB2B),
      pickedBy: record.pickedBy,
      completedAt: record.completedAt,
      completedBy: record.completedBy,
      pickers: PICKERS,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update one item's pick status: not_picked -> picked -> missing -> not_picked
app.post("/api/picking-item", async (req, res) => {
  try {
    const { stopName, itemIndex, status, note } = req.body;
    if (!stopName || itemIndex === undefined || !status) {
      return res.status(400).json({ error: "stopName, itemIndex, and status required" });
    }
    const cache = await fetchTodaysStopOrders();
    const key = pickingKeyFor(stopName);
    const order = cache.byStopName[key];
    if (!order) return res.status(404).json({ error: "No order found for this stop." });

    const state = loadState();
    const record = getPickingRecord(state, key, order);
    record.itemStatus[itemIndex] = status;
    if (note !== undefined) {
      record.itemNotes[itemIndex] = note;
    }
    saveState(state);
    res.json({ ok: true, itemStatus: record.itemStatus, itemNotes: record.itemNotes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Assign which employee is working this order — tracked for accountability
app.post("/api/picking-set-picker", async (req, res) => {
  try {
    const { stopName, picker } = req.body;
    if (!stopName) return res.status(400).json({ error: "stopName required" });
    const cache = await fetchTodaysStopOrders();
    const key = pickingKeyFor(stopName);
    const order = cache.byStopName[key];
    if (!order) return res.status(404).json({ error: "No order found for this stop." });

    const state = loadState();
    const record = getPickingRecord(state, key, order);
    record.pickedBy = picker || null;
    saveState(state);
    res.json({ ok: true, pickedBy: record.pickedBy });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Locks an order as finished — but ONLY if every single line item has
// been explicitly marked Picked or Missing. This is the actual fix for
// "forgotten" items: nothing can silently slip through untouched.
app.post("/api/picking-finish", async (req, res) => {
  try {
    const { stopName } = req.body;
    if (!stopName) return res.status(400).json({ error: "stopName required" });
    const cache = await fetchTodaysStopOrders();
    const key = pickingKeyFor(stopName);
    const order = cache.byStopName[key];
    if (!order) return res.status(404).json({ error: "No order found for this stop." });

    const state = loadState();
    const record = getPickingRecord(state, key, order);

    if (!record.pickedBy) {
      return res.status(400).json({ error: "Select who's picking this order first." });
    }

    const outstanding = order.lineItems
      .map((item, idx) => ({ idx, title: item.title, status: record.itemStatus[idx] || "not_picked" }))
      .filter((item) => item.status === "not_picked");

    if (outstanding.length > 0) {
      return res.status(400).json({
        error: `${outstanding.length} item(s) still need to be marked before finishing.`,
        outstanding,
      });
    }

    record.completedAt = new Date().toISOString();
    record.completedBy = record.pickedBy;
    saveState(state);
    res.json({ ok: true, completedAt: record.completedAt, completedBy: record.completedBy });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Undoes a Finish — clears the completed lock so the order can be edited
// again (e.g. a mistake was noticed after finishing).
app.post("/api/picking-reopen", async (req, res) => {
  try {
    const { stopName } = req.body;
    if (!stopName) return res.status(400).json({ error: "stopName required" });
    const cache = await fetchTodaysStopOrders();
    const key = pickingKeyFor(stopName);
    const order = cache.byStopName[key];
    if (!order) return res.status(404).json({ error: "No order found for this stop." });

    const state = loadState();
    const record = getPickingRecord(state, key, order);
    record.completedAt = null;
    record.completedBy = null;
    saveState(state);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generates a PDF containing ONLY the items marked missing — meant to be
// printed and sent along with the driver, or handed to the store, so their
// team knows exactly what didn't make it onto the truck.
app.get("/api/missing-items-pdf/:stopName", async (req, res) => {
  try {
    const cache = await fetchTodaysStopOrders();
    const key = pickingKeyFor(decodeURIComponent(req.params.stopName));
    const order = cache.byStopName[key];
    if (!order) return res.status(404).send("No order found for this stop.");

    const state = loadState();
    const record = getPickingRecord(state, key, order);

    const missingItems = order.lineItems
      .map((item, idx) => ({ ...item, idx, note: record.itemNotes[idx] || "" }))
      .filter((item) => record.itemStatus[item.idx] === "missing");

    if (missingItems.length === 0) {
      return res.status(404).send("No items are currently marked missing for this order.");
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${order.orderName}-missing-items.pdf"`
    );

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    function drawMissingHeaders() {
      doc.fontSize(9).fillColor("#999999");
      doc.text("QTY", 50, doc.y, { width: 40, lineBreak: false });
      doc.text("ITEM", 95, doc.y - 11, { width: 280, lineBreak: false });
      doc.text("REASON", 380, doc.y - 11, { lineBreak: false });
      doc.moveDown(0.6);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#dddddd").stroke();
      doc.moveDown(0.6);
    }

    const pageUsableWidthMissing = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const stopNameUpperMissing = req.params.stopName.toUpperCase();

    doc.font("Helvetica-Bold").fontSize(18).fillColor("#555555").text("HUMMUS FIT", { align: "left" });
    doc.moveDown(0.1);
    const stopFontSizeMissing = fitTextFontSize(doc, stopNameUpperMissing, pageUsableWidthMissing, 60, 32);
    doc.font("Helvetica-Bold").fontSize(stopFontSizeMissing).fillColor("#111111").text(stopNameUpperMissing, { align: "left" });
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#B23A2E").text("MISSING ITEMS REPORT", { align: "left" });
    doc.font("Helvetica");
    doc.moveDown(1);

    doc.fontSize(13).fillColor("#111111").text(`Order: ${order.orderName}`);
    doc.fontSize(10).fillColor("#666666").text(
      `Reported: ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`
    );
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#dddddd").stroke();
    doc.moveDown(0.7);
    drawMissingHeaders();

    const pageBottom = doc.page.height - doc.page.margins.bottom;

    missingItems.forEach((item, i) => {
      const textHeight = doc.heightOfString(item.title, { width: 280, fontSize: 11 });
      const estimatedRowHeight = Math.max(20, textHeight + 8);

      if (doc.y + estimatedRowHeight > pageBottom) {
        doc.addPage();
        doc.y = 50;
        drawMissingHeaders();
      }

      const rowY = doc.y;
      if (i % 2 === 1) {
        doc.rect(46, rowY - 3, 503, estimatedRowHeight).fill("#FBEAE8");
      }
      doc.fontSize(11).fillColor("#111111");
      doc.text(String(item.quantity), 50, rowY + 1, { width: 40 });
      doc.text(item.title, 95, rowY + 1, { width: 280 });
      doc.fontSize(10).fillColor("#666666").text(item.note || "—", 380, rowY + 1, { width: 160 });
      const afterY = Math.max(doc.y, rowY + 20);
      doc.y = afterY + 6;
    });

    if (doc.y + 40 > pageBottom) {
      doc.addPage();
      doc.y = 50;
    }

    doc.moveDown(0.8);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#dddddd").stroke();
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#666666").text(`${missingItems.length} item(s) missing from this order.`);

    doc.end();
  } catch (err) {
    res.status(500).send("Error generating missing items report: " + err.message);
  }
});

// ================= BOUNCIE — LIVE VAN STATUS =================
const BOUNCIE_CLIENT_ID = process.env.BOUNCIE_CLIENT_ID;
const BOUNCIE_CLIENT_SECRET = process.env.BOUNCIE_CLIENT_SECRET;
const BOUNCIE_AUTH_CODE = process.env.BOUNCIE_AUTH_CODE;
const BOUNCIE_REDIRECT_URI = process.env.BOUNCIE_REDIRECT_URI || "https://www.bouncie.dev";

let bouncieToken = null;
let bouncieTokenExpiresAt = 0;

async function getBouncieToken() {
  const now = Date.now();
  if (bouncieToken && now < bouncieTokenExpiresAt - 30000) return bouncieToken;
  if (!BOUNCIE_CLIENT_ID || !BOUNCIE_CLIENT_SECRET || !BOUNCIE_AUTH_CODE) {
    throw new Error("Bouncie not configured");
  }
  const body = new URLSearchParams({
    client_id: BOUNCIE_CLIENT_ID,
    client_secret: BOUNCIE_CLIENT_SECRET,
    grant_type: "authorization_code",
    code: BOUNCIE_AUTH_CODE,
    redirect_uri: BOUNCIE_REDIRECT_URI,
  });
  const res = await fetch("https://auth.bouncie.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: BOUNCIE_CLIENT_ID,
      client_secret: BOUNCIE_CLIENT_SECRET,
      grant_type: "authorization_code",
      code: BOUNCIE_AUTH_CODE,
      redirect_uri: BOUNCIE_REDIRECT_URI,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error("Bouncie token error: " + JSON.stringify(data));
  bouncieToken = data.access_token;
  bouncieTokenExpiresAt = now + (data.expires_in || 3300) * 1000;
  return bouncieToken;
}

let vanStatusCache = { fetchedAt: 0, vehicles: [] };
const VAN_STATUS_CACHE_MS = 20 * 1000;

app.get("/api/van-status", async (req, res) => {
  const now = Date.now();
  if (now - vanStatusCache.fetchedAt < VAN_STATUS_CACHE_MS) {
    return res.json({ vehicles: vanStatusCache.vehicles, configured: true });
  }
  try {
    const token = await getBouncieToken();
    const r = await fetch("https://api.bouncie.dev/v1/vehicles", {
      headers: { Authorization: token },
    });
    const vehicles = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(vehicles));
    const simplified = vehicles.map((v) => ({
      nickName: v.nickName || v.model || "",
      speed: (v.stats && v.stats.speed) || 0,
      isRunning: !!(v.stats && v.stats.isRunning),
      address: (v.stats && v.stats.location && v.stats.location.address) || "",
    }));
    vanStatusCache = { fetchedAt: now, vehicles: simplified };
    res.json({ vehicles: simplified, configured: true });
  } catch (err) {
    res.json({ vehicles: [], configured: false, error: err.message });
  }
});

// ================= GOOGLE MAPS — ROUTE OPTIMIZATION & LIVE ETA =================
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

function getRouteById(routeId) {
  return ROUTES.find((r) => r.id === routeId);
}

// Commercial vans can't legally use NY-area parkways (low bridge clearances,
// posted no-commercial-vehicle restrictions). Google's Directions API has no
// "avoid this specific road" option, so instead we check every route it
// generates against the real list of restricted parkways and flag it
// clearly if any leg would send a driver onto one.
const RESTRICTED_PARKWAYS = [
  // NYC
  "Belt Parkway", "Belt Pkwy",
  "FDR Drive", "Franklin D. Roosevelt Drive",
  "Henry Hudson Parkway", "Henry Hudson Pkwy",
  "Cross Island Parkway", "Cross Island Pkwy",
  "Jackie Robinson Parkway", "Jackie Robinson Pkwy",
  "Bronx River Parkway", "Bronx River Pkwy",
  "Hutchinson River Parkway", "Hutchinson River Pkwy", "Hutch River Pkwy",
  "Mosholu Parkway", "Mosholu Pkwy",
  "Pelham Parkway", "Pelham Pkwy",
  "Ocean Parkway", "Ocean Pkwy",
  "Korean War Veterans Parkway", "Korean War Veterans Pkwy",
  "Grand Central Parkway", "Grand Central Pkwy",
  // Long Island
  "Bethpage State Parkway", "Bethpage Parkway", "Bethpage Pkwy",
  "Heckscher State Parkway", "Heckscher Parkway", "Heckscher Pkwy",
  "Loop Parkway", "Loop Pkwy",
  "Meadowbrook State Parkway", "Meadowbrook Parkway", "Meadowbrook Pkwy",
  "Northern State Parkway", "Northern State Pkwy", "Northern Parkway", "Northern Pkwy",
  "Robert Moses Causeway",
  "Sagtikos State Parkway", "Sagtikos Parkway", "Sagtikos Pkwy",
  "Sunken Meadow State Parkway", "Sunken Meadow Parkway", "Sunken Meadow Pkwy",
  "Southern State Parkway", "Southern State Pkwy", "Southern Parkway", "Southern Pkwy",
  "Wantagh State Parkway", "Wantagh Parkway", "Wantagh Pkwy",
  // Hudson Valley (unlikely for these routes, but included for completeness)
  "Cross County Parkway", "Cross County Pkwy",
  "Saw Mill River Parkway", "Saw Mill River Pkwy",
  "Taconic State Parkway", "Taconic Pkwy",
  "Sprain Brook Parkway", "Sprain Brook Pkwy",
  "Long Mountain Parkway", "Long Mountain Pkwy",
  "Bear Mountain Parkway", "Bear Mountain Pkwy",
  "Palisades Interstate Parkway", "Palisades Pkwy",
  "Lake Welch Parkway", "Lake Welch Pkwy",
];
const restrictedLower = RESTRICTED_PARKWAYS.map((p) => p.toLowerCase());

function stripHtml(text) {
  return text.replace(/<[^>]*>/g, "");
}

// Pulls out anything that looks like "___ Parkway" or "___ Pkwy" from a
// turn-by-turn instruction, regardless of whether it's on our known list —
// this catches parkways we might not have thought to list explicitly.
function extractParkwayMentions(instructionHtml) {
  const text = stripHtml(instructionHtml);
  const results = new Set();
  const connectorRegex =
    /\b(?:onto|on|toward|via)\s+([A-Z][\w.'-]*(?:\s[A-Za-z.'-]+){0,4}?\s(?:Parkway|Pkwy))\b/g;
  let m;
  while ((m = connectorRegex.exec(text)) !== null) {
    results.add(m[1].replace(/\s[NSEW]$/, "").trim());
  }
  if (results.size === 0) {
    const bareRegex = /\b([A-Z][\w.'-]*(?:\s[A-Za-z.'-]+){0,3}\s(?:Parkway|Pkwy))\b/g;
    while ((m = bareRegex.exec(text)) !== null) {
      results.add(m[1].replace(/\s[NSEW]$/, "").trim());
    }
  }
  return Array.from(results);
}

// Calls Google Directions API to find the fastest stop order for a route,
// starting and ending at HQ. Returns the optimized stop order plus the
// estimated drive time (seconds) for each leg of the trip.
async function optimizeRouteWithGoogle(route) {
  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error("GOOGLE_MAPS_API_KEY not configured");
  }
  const origin = encodeURIComponent(HQ.address);
  const destination = encodeURIComponent(HQ.address);
  const waypoints =
    "optimize:true|" + route.stops.map((s) => encodeURIComponent(s.address)).join("|");

  const url =
    `https://maps.googleapis.com/maps/api/directions/json` +
    `?origin=${origin}&destination=${destination}&waypoints=${waypoints}` +
    `&mode=driving&key=${GOOGLE_MAPS_API_KEY}`;

  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== "OK" || !data.routes || !data.routes[0]) {
    throw new Error(`Google Directions error: ${data.status} ${data.error_message || ""}`);
  }

  const googleRoute = data.routes[0];
  const waypointOrder = googleRoute.waypoint_order; // indices into route.stops, in optimized visit order
  const legs = googleRoute.legs; // length = stops.length + 1 (HQ->stop1->stop2->...->HQ)

  const optimizedStops = waypointOrder.map((idx) => route.stops[idx]);
  const legDurations = legs.map((leg) => leg.duration.value); // seconds
  const legDistances = legs.map((leg) => leg.distance.text);

  // Scan every turn-by-turn step across every leg for parkway mentions.
  // Only flag ones that match the actual real restricted-parkway list —
  // plenty of ordinary roads have "Parkway" or "Pkwy" in their name
  // without being one of the legally-restricted ones (e.g. HQ's own
  // street, Motor Pkwy, is a normal local road, not a state parkway).
  const flaggedSet = new Set();
  legs.forEach((leg) => {
    (leg.steps || []).forEach((step) => {
      const mentions = extractParkwayMentions(step.html_instructions || "");
      mentions.forEach((mention) => {
        const isKnownRestricted = restrictedLower.includes(mention.toLowerCase());
        if (isKnownRestricted) {
          flaggedSet.add(mention);
        }
      });
    });
  });

  return {
    optimizedStopIds: optimizedStops.map((s) => s.id),
    legDurationsSeconds: legDurations,
    legDistances,
    totalDurationSeconds: legDurations.reduce((a, b) => a + b, 0),
    flaggedParkways: Array.from(flaggedSet),
    computedAt: new Date().toISOString(),
  };
}

app.post("/api/optimize-route", async (req, res) => {
  const { routeId } = req.body;
  const route = getRouteById(routeId);
  if (!route) return res.status(404).json({ error: "Route not found" });

  try {
    const optimized = await optimizeRouteWithGoogle(route);
    const state = loadState();
    state.routeMeta[routeId] = {
      ...(state.routeMeta[routeId] || {}),
      ...optimized,
    };
    saveState(state);
    res.json({ ok: true, optimized, state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/start-route", async (req, res) => {
  const { routeId } = req.body;
  const route = getRouteById(routeId);
  if (!route) return res.status(404).json({ error: "Route not found" });

  const state = loadState();
  try {
    // If we don't already have an optimized order cached for today, compute one now
    if (!state.routeMeta[routeId] || !state.routeMeta[routeId].optimizedStopIds) {
      const optimized = await optimizeRouteWithGoogle(route);
      state.routeMeta[routeId] = { ...(state.routeMeta[routeId] || {}), ...optimized };
    }
    state.routeMeta[routeId].startedAt = new Date().toISOString();
    saveState(state);
    res.json({ ok: true, state });
  } catch (err) {
    // Even if Google Maps isn't configured/fails, still record the start time
    // so the board reflects reality — just without ETAs.
    state.routeMeta[routeId] = {
      ...(state.routeMeta[routeId] || {}),
      startedAt: new Date().toISOString(),
    };
    saveState(state);
    res.json({ ok: true, state, warning: err.message });
  }
});

app.get("/api/route-eta/:routeId", (req, res) => {
  const state = loadState();
  const meta = state.routeMeta[req.params.routeId];
  if (!meta || !meta.startedAt || !meta.legDurationsSeconds) {
    return res.json({ available: false });
  }
  const startedAt = new Date(meta.startedAt).getTime();
  const UNLOAD_MS = UNLOAD_MINUTES_PER_STOP * 60 * 1000;
  let cumulativeMs = 0;
  const etaByStopId = {};
  meta.optimizedStopIds.forEach((stopId, i) => {
    cumulativeMs += meta.legDurationsSeconds[i] * 1000;
    etaByStopId[stopId] = new Date(startedAt + cumulativeMs).toISOString();
    // After arriving, the driver needs time to unload before the next
    // leg of driving can realistically begin.
    cumulativeMs += UNLOAD_MS;
  });
  // final leg is the trip back to HQ (no unload time needed at HQ itself)
  cumulativeMs += meta.legDurationsSeconds[meta.legDurationsSeconds.length - 1] * 1000;
  const etaBackToHQ = new Date(startedAt + cumulativeMs).toISOString();

  res.json({
    available: true,
    optimizedStopIds: meta.optimizedStopIds,
    etaByStopId,
    etaBackToHQ,
    startedAt: meta.startedAt,
    unloadMinutesPerStop: UNLOAD_MINUTES_PER_STOP,
  });
});

app.get("/api/status", (req, res) => {
  const { windowStart, windowEnd, isOpen } = getOrderWindowEastern(new Date());
  res.json({
    shopifyConfigured: Boolean(SHOP_DOMAIN && SHOPIFY_TOKEN),
    bouncieConfigured: Boolean(BOUNCIE_CLIENT_ID && BOUNCIE_CLIENT_SECRET && BOUNCIE_AUTH_CODE),
    mapsConfigured: Boolean(GOOGLE_MAPS_API_KEY),
    fleetTrackerUrl: FLEET_TRACKER_URL,
    serverTimeEastern: new Date().toISOString(),
    orderWindow: {
      start: windowStart.toISOString(),
      end: windowEnd.toISOString(),
      isOpen,
    },
  });
});

app.get("/picking", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "picking.html"));
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Route board running on port ${PORT}`);
});
