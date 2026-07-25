const express = require("express");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, "data.json");

app.use(express.json());

// ================= ROUTE DEFINITIONS =================
const ROUTES = [
  {
    id: "r1",
    name: "Route #1",
    time: "4:00 AM",
    vanSize: "Large (350)",
    stops: [
      { id: "r1-1", name: "Lindenhurst" },
      { id: "r1-2", name: "Lynbrook" },
      { id: "r1-3", name: "Island Park" },
      { id: "r1-4", name: "Bellmore" },
    ],
  },
  {
    id: "r2",
    name: "Route #2",
    time: "7:30 AM",
    vanSize: "Large (350)",
    stops: [
      { id: "r2-1", name: "Islip" },
      { id: "r2-2", name: "Farmingdale" },
      { id: "r2-3", name: "Deer Park" },
    ],
  },
  {
    id: "r3",
    name: "Route #3 — Üçüncü",
    time: "9:00 AM",
    vanSize: "Small",
    stops: [
      { id: "r3-1", name: "Woodbury" },
      { id: "r3-2", name: "Huntington" },
      { id: "r3-3", name: "Ozone Park", brand: "Natural Body" },
      { id: "r3-4", name: "Hicksville", brand: "Natural Body" },
    ],
  },
  {
    id: "r4",
    name: "Route #4",
    time: "8:00 AM",
    vanSize: "Any",
    stops: [
      { id: "r4-1", name: "Selden" },
      { id: "r4-2", name: "Miller Place" },
      { id: "r4-3", name: "Lake Grove" },
    ],
  },
  {
    id: "r5",
    name: "Route #5",
    time: "8:00 AM",
    vanSize: "Any",
    stops: [
      { id: "r5-1", name: "Holbrook" },
      { id: "r5-2", name: "Ronkonkoma" },
    ],
  },
];

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

const FLEET_TRACKER_URL = "https://hummusfit-fleet-tracker-production.up.railway.app";

// ================= DAY / STATE PERSISTENCE =================
function todayEastern() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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

function loadState() {
  try {
    const state = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (state.day !== todayEastern()) {
      return { day: todayEastern(), assignments: {}, stopStatus: {} };
    }
    return state;
  } catch (e) {
    return { day: todayEastern(), assignments: {}, stopStatus: {} };
  }
}
function saveState(state) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

app.get("/api/routes", (req, res) => {
  res.json({ routes: ROUTES, fleet: FLEET });
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
  state.stopStatus[stopId] = status;
  saveState(state);
  res.json({ ok: true, state });
});
app.post("/api/reset-day", (req, res) => {
  const state = { day: todayEastern(), assignments: {}, stopStatus: {} };
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
      // First matching order per stop name wins (most recent order stays if duplicates)
      const key = tag.toLowerCase();
      if (!byStopName[key]) {
        byStopName[key] = {
          orderId: order.id,
          orderName: order.name,
          createdAt: order.createdAt,
          lineItems: order.lineItems.edges.map((e) => e.node),
        };
      }
    });
  });

  ordersCache = { fetchedAt: now, byStopName, windowStart, windowEnd };
  return ordersCache;
}

app.get("/api/today-orders", async (req, res) => {
  try {
    const cache = await fetchTodaysStopOrders();
    res.json({
      byStopName: cache.byStopName,
      windowStart: cache.windowStart,
      windowEnd: cache.windowEnd,
      configured: Boolean(SHOP_DOMAIN && SHOPIFY_TOKEN),
    });
  } catch (err) {
    res.json({ byStopName: {}, configured: false, error: err.message });
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

    doc.fontSize(20).fillColor("#111111").text("HUMMUS FIT", { align: "left" });
    doc.fontSize(11).fillColor("#666666").text("Packing Slip", { align: "left" });
    doc.moveDown(1);

    doc.fontSize(13).fillColor("#111111").text(`Order: ${order.orderName}`);
    doc.fontSize(10).fillColor("#666666").text(`Ship To: ${req.params.stopName}`);
    doc.text(`Date: ${new Date(order.createdAt).toLocaleString("en-US", { timeZone: "America/New_York" })}`);
    doc.moveDown(1);

    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#dddddd").stroke();
    doc.moveDown(0.5);

    doc.fontSize(11).fillColor("#111111");
    order.lineItems.forEach((item) => {
      doc.text(`${item.quantity} x  ${item.title}${item.sku ? "  (SKU: " + item.sku + ")" : ""}`);
      doc.moveDown(0.3);
    });

    doc.moveDown(1);
    const totalItems = order.lineItems.reduce((sum, i) => sum + i.quantity, 0);
    doc.fontSize(10).fillColor("#666666").text(`Total items: ${totalItems}`);

    doc.end();
  } catch (err) {
    res.status(500).send("Error generating packing slip: " + err.message);
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

app.get("/api/status", (req, res) => {
  const { windowStart, windowEnd, isOpen } = getOrderWindowEastern(new Date());
  res.json({
    shopifyConfigured: Boolean(SHOP_DOMAIN && SHOPIFY_TOKEN),
    bouncieConfigured: Boolean(BOUNCIE_CLIENT_ID && BOUNCIE_CLIENT_SECRET && BOUNCIE_AUTH_CODE),
    fleetTrackerUrl: FLEET_TRACKER_URL,
    serverTimeEastern: new Date().toISOString(),
    orderWindow: {
      start: windowStart.toISOString(),
      end: windowEnd.toISOString(),
      isOpen,
    },
  });
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Route board running on port ${PORT}`);
});
