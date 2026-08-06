const express = require("express");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { loadLocationIndex, findLocation } = require("./walkin-locations.js");
const webpush = require("web-push");

// The crate label printer is black-ink-only (thermal) — no brand colors
// on the physical label, so "professional" has to come from real
// typography/layout/logo instead of color. This is the black-silhouette
// version of the logo (transparent PNG, solid black fill) made just for
// that — the color version lives at public/assets/logo.png for on-screen
// use, this one is print-safe.
const LOGO_BLACK_PATH = path.join(__dirname, "public", "assets", "logo-black.png");

// Same store-facing receiving-check app the ETA banner and van tracking
// point at — the crate label's QR code sends whoever receives the
// delivery straight to that store's receiving check, no need to already
// have it bookmarked.
const RECEIVING_APP_URL =
  process.env.RECEIVING_APP_URL || "https://hummusfit-receiving-production.up.railway.app";

// Non-fridge supply items (paper goods, plastic goods, spoons, garbage
// bags, etc.) live on the other side of the building from the fridge/
// backstock area and will never appear in the blueprint lane feed — they
// sort dead last, after food items that just haven't been wired into the
// blueprint yet. This must run BEFORE an order's lineItems array is ever
// stored, since /api/picking-order, /api/picking-item, the packing slip,
// and the missing-items report all key picked/missing/note state purely
// by array position — sorting has to happen once, upstream, so every
// consumer sees the same stable index for the same item.
const SUPPLY_KEYWORDS = /\b(spoon|fork|knife|utensil|napkin|garbage bag|trash bag|paper|plastic|cup|lid|straw|sleeve|packaging|hoodie|apparel|gift card|crop hoodie)\b/i;
async function sortItemsForPicking(items) {
  const laneIndex = await loadLocationIndex();
  const withMeta = items.map((item) => ({
    item,
    location: findLocation(laneIndex, item.title),
    isSupply: SUPPLY_KEYWORDS.test(item.title),
  }));
  withMeta.sort((a, b) => {
    const tierA = a.location ? 0 : a.isSupply ? 2 : 1;
    const tierB = b.location ? 0 : b.isSupply ? 2 : 1;
    if (tierA !== tierB) return tierA - tierB;
    if (tierA === 0) {
      const ka = a.location.sortKey;
      const kb = b.location.sortKey;
      for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
        const av = ka[i] === undefined ? 0 : ka[i];
        const bv = kb[i] === undefined ? 0 : kb[i];
        if (av < bv) return -1;
        if (av > bv) return 1;
      }
      return 0;
    }
    return a.item.title.localeCompare(b.item.title);
  });
  return withMeta.map((m) => m.item);
}

// Real VAPID keypair for push notifications — the public one gets handed
// to the browser when it subscribes, the private one signs outgoing
// notifications server-side. These need to stay stable (don't
// regenerate them) or every existing subscriber's subscription breaks.
const VAPID_PUBLIC_KEY =
  "BPOP3h7QFDviLTCcd8OLIMK0vyXYTa_icDUddsj7CzkZ9ohVOugqQ35QSebi9YsmVMeWeU93WNs-bOEFOl9kou4";
const VAPID_PRIVATE_KEY = "MtFdE8HQmopjtFzUIEZ69D_ll-wr-yWWXWph92L_nd8";
webpush.setVapidDetails(
  "mailto:ops@hummusfitmeals.com",
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const SUBSCRIPTIONS_FILE = path.join(__dirname, "push-subscriptions.json");
function loadSubscriptions() {
  try {
    return JSON.parse(fs.readFileSync(SUBSCRIPTIONS_FILE, "utf8"));
  } catch (e) {
    return [];
  }
}
function saveSubscriptions(subs) {
  fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subs, null, 2));
}

// Sends one push notification to every subscribed device. If a specific
// subscription is no longer valid (uninstalled, permissions revoked),
// Web Push returns a 410/404 — clean those out automatically instead of
// letting the list quietly fill up with dead subscriptions.
async function sendPushToAll(payload) {
  const subs = loadSubscriptions();
  const stillValid = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      stillValid.push(sub);
    } catch (err) {
      if (err.statusCode !== 410 && err.statusCode !== 404) {
        stillValid.push(sub); // keep it — might be a transient error, not a dead subscription
      }
    }
  }
  if (stillValid.length !== subs.length) saveSubscriptions(stillValid);
}

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

// state.picking gets wiped every day at midnight so today's board
// starts clean — correct for day-to-day picking, but wrong for
// receiving checks, which legitimately might not happen until after
// midnight for a delivery that was picked the evening before. This
// separate file is NEVER touched by the daily reset, so a completed
// order's real picked data stays findable regardless of what day it
// currently is when someone actually checks it in.
const ARCHIVE_FILE = path.join(__dirname, "completed-orders-archive.json");
function loadArchive() {
  try {
    return JSON.parse(fs.readFileSync(ARCHIVE_FILE, "utf8"));
  } catch (e) {
    return {};
  }
}
function saveArchive(archive) {
  fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(archive, null, 2));
}
function archiveCompletedOrder(stopKey, record, order) {
  const archive = loadArchive();
  archive[stopKey] = {
    ...record,
    archivedAt: new Date().toISOString(),
    orderName: order.orderName,
    isB2B: Boolean(order.isB2B),
    lineItems: order.lineItems,
  };
  saveArchive(archive);
}

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

// Out-of-state / B2B routes — same exact structure as local ROUTES
// above, plus a `day` field (0=Sun..6=Sat, matching JS Date.getDay())
// since these run weekly on specific days rather than every day. The
// stop order here is Tony's own already-finalized sequence — Create
// Route for these builds the Google Maps link using THIS order rather
// than letting Google re-optimize it, since the planning is already done.
const B2B_ROUTES = [
  {
    id: "b2b-mon-v1",
    day: 1,
    name: "Monday — Van 1",
    van: "Van 1",
    miles: 241,
    baseShiftHours: 7.2,
    stops: [
      { id: "b2b-mon-v1-1", name: "Harrison", address: "229 Harrison Ave, Harrison, NY 10528" },
      { id: "b2b-mon-v1-2", name: "Brookfield", address: "540 Federal Rd Unit 2B, Brookfield, CT 06804" },
      // Fishkill isn't a separate physical drop — same owner as
      // Brookfield, dropped at the same address, and relayed onward by
      // the Brookfield owner himself. Same address on purpose (no real
      // extra driving happens), but its own stop entry so its orders
      // get matched, picked, and labeled completely separately.
      { id: "b2b-mon-v1-2b", name: "Fishkill", address: "540 Federal Rd Unit 2B, Brookfield, CT 06804" },
      { id: "b2b-mon-v1-3", name: "Carmel", address: "51 Gleneida Ave, Carmel Hamlet, NY 10512" },
      { id: "b2b-mon-v1-4", name: "Yorktown", address: "1420 E Main St, Shrub Oak, NY 10588" },
      { id: "b2b-mon-v1-5", name: "Nourish'd", address: "91 High Ridge Rd, Stamford, CT 06905" },
    ],
  },
  {
    id: "b2b-mon-v2",
    day: 1,
    name: "Monday — Van 2",
    van: "Van 2",
    miles: 393,
    baseShiftHours: 9.9,
    stops: [
      { id: "b2b-mon-v2-1", name: "Rochelle", address: "5 W Passaic St #1b, Rochelle Park, NJ 07662" },
      { id: "b2b-mon-v2-2", name: "PWRBLD Philadelphia", address: "1 S Broad St, Philadelphia, PA 19107" },
      { id: "b2b-mon-v2-3", name: "Ares Philadelphia", address: "3354 Grant Ave, Philadelphia, PA 19114" },
      { id: "b2b-mon-v2-4", name: "Ares Hamilton", address: "1061 White Horse Ave, Hamilton Township, NJ 08610" },
    ],
  },
  {
    id: "b2b-tue-v1",
    day: 2,
    name: "Tuesday — Van 1",
    van: "Van 1",
    miles: 440,
    baseShiftHours: 9.4,
    stops: [
      { id: "b2b-tue-v1-1", name: "Wyomissing", address: "92 Commerce Dr, Wyomissing, PA 19610" },
      { id: "b2b-tue-v1-2", name: "Bethlehem", address: "2134 W Union Blvd, Bethlehem, PA 18018" },
    ],
  },
  {
    id: "b2b-tue-v2",
    day: 2,
    name: "Tuesday — Van 2",
    van: "Van 2",
    miles: 268,
    baseShiftHours: 7.3,
    stops: [
      { id: "b2b-tue-v2-1", name: "Meriden", address: "477 S Broad St Ste 8, Meriden, CT 06451" },
      { id: "b2b-tue-v2-2", name: "Orange", address: "297 Boston Post Rd #14, Orange, CT 06477" },
      { id: "b2b-tue-v2-3", name: "Shelton", address: "890 Bridgeport Ave Ste 14, Shelton, CT 06484" },
      // NOTE: Fairfield's zip code was not provided — address works for
      // Google Maps as-is, but worth adding the zip if you have it handy.
      { id: "b2b-tue-v2-4", name: "Fairfield", address: "2465 Black Rock Tpke Unit D, Fairfield, CT" },
      { id: "b2b-tue-v2-5", name: "Nourish'd", address: "91 High Ridge Rd, Stamford, CT 06905" },
    ],
  },
  {
    id: "b2b-wed-v1",
    day: 3,
    name: "Wednesday — Van 1",
    van: "Van 1",
    miles: 450,
    baseShiftHours: 10.7,
    stops: [
      { id: "b2b-wed-v1-1", name: "New Castle", address: "71 Industrial Blvd, New Castle, DE 19720" },
      { id: "b2b-wed-v1-2", name: "Ares Sewell", address: "508 Hurffville - Cross Keys Rd, Sewell, NJ 08080" },
      { id: "b2b-wed-v1-3", name: "King of Gains", address: "2501 US-130 Ste 4, Cinnaminson, NJ 08077" },
      { id: "b2b-wed-v1-4", name: "Ares Mt Laurel", address: "4309 Dearborn Cir, Mt Laurel Township, NJ 08054" },
    ],
  },
  {
    id: "b2b-thu-v1",
    day: 4,
    name: "Thursday — Van 1",
    van: "Van 1",
    miles: 235,
    baseShiftHours: 6.6,
    stops: [
      { id: "b2b-thu-v1-1", name: "Harrison", address: "229 Harrison Ave, Harrison, NY 10528" },
      { id: "b2b-thu-v1-2", name: "Brookfield", address: "540 Federal Rd Unit 2B, Brookfield, CT 06804" },
      { id: "b2b-thu-v1-2b", name: "Fishkill", address: "540 Federal Rd Unit 2B, Brookfield, CT 06804" },
      { id: "b2b-thu-v1-3", name: "Carmel", address: "51 Gleneida Ave, Carmel Hamlet, NY 10512" },
      { id: "b2b-thu-v1-4", name: "Yorktown", address: "1420 E Main St, Shrub Oak, NY 10588" },
    ],
  },
  {
    id: "b2b-fri-v1",
    day: 5,
    name: "Friday — Van 1",
    van: "Van 1",
    miles: 268,
    baseShiftHours: 7.3,
    stops: [
      { id: "b2b-fri-v1-1", name: "Meriden", address: "477 S Broad St Ste 8, Meriden, CT 06451" },
      { id: "b2b-fri-v1-2", name: "Orange", address: "297 Boston Post Rd #14, Orange, CT 06477" },
      { id: "b2b-fri-v1-3", name: "Shelton", address: "890 Bridgeport Ave Ste 14, Shelton, CT 06484" },
      { id: "b2b-fri-v1-4", name: "Fairfield", address: "2465 Black Rock Tpke Unit D, Fairfield, CT" },
      { id: "b2b-fri-v1-5", name: "Nourish'd", address: "91 High Ridge Rd, Stamford, CT 06905" },
    ],
  },
  {
    id: "b2b-fri-v2",
    day: 5,
    name: "Friday — Van 2",
    van: "Van 2",
    miles: 409,
    baseShiftHours: 9.6,
    stops: [
      { id: "b2b-fri-v2-1", name: "Rochelle", address: "5 W Passaic St #1b, Rochelle Park, NJ 07662" },
      { id: "b2b-fri-v2-2", name: "PWRBLD KOP", address: "167 Town Center Rd, King of Prussia, PA 19406" },
      { id: "b2b-fri-v2-3", name: "PWRBLD Warrington", address: "1661 Easton Rd Unit C-1, Warrington, PA 18976" },
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
  ROUTES.concat(B2B_ROUTES).flatMap((route) =>
    route.stops.map((s) => [
      s.name.toLowerCase(),
      { isB2B: Boolean(s.isB2B) || Boolean(route.day !== undefined), deliveryDays: s.deliveryDays || null },
    ])
  )
);

// order objects only carry the Shopify order name (like "#123"), not the
// stop's real display name — this maps the lowercase key used internally
// back to how it should actually be shown (e.g. "harrison" -> "Harrison").
const STOP_DISPLAY_NAME = new Map(
  ROUTES.concat(B2B_ROUTES).flatMap((route) => route.stops.map((s) => [s.name.toLowerCase(), s.name]))
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

// Maps this app's van dropdown labels (what dispatchers actually pick,
// stored verbatim in state.assignments[routeId].van) to that same
// vehicle's Bouncie IMEI — the one identifier Bouncie guarantees is
// stable. Bouncie's own nickName field is free-typed and already drifts
// from these labels (typos, missing words, trailing spaces — "Buffin Tow
// Truck" here vs "Buffinn Tow Truck" in Bouncie), so matching by name at
// runtime would be fragile. Confirmed by hand against a live /api/vehicles
// pull on 8/5/2026 — update this if a van is swapped or re-registered.
const VAN_TO_BOUNCIE_IMEI = {
  "2022 RAM Promaster 1500": "866392062048891",
  "2016 FORD Transit": "866016061363304",
  "Small Diesel 2 — Mercedes Sprinter": "352602116156370",
  "Mercedes Big Muffin — Sprinter": "866392061981985",
  "Mercedes Small 3 — Sprinter": "862255068841805",
  "Buffin Tow Truck — Sprinter": "352602116154938",
  "Transit 350 (1)": "865612072243575",
  "Big White — Sprinter": "865612072353903",
  "Ford Transit 3": "864486067680666",
  "Darian — Ford Transit": "865612072360866",
};

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

// Maps a picker's name to their headshot file under /public/headshots/.
// Anyone not listed here just falls back to an initials avatar on the
// frontend — so this works today with zero photos on file, and each
// name upgrades to a real photo the moment one gets added here.
const PICKER_PHOTOS = {
  "Hazar Kutuk": "/headshots/hazar-kutuk.png",
};

function pickerPhotoFor(name) {
  return PICKER_PHOTOS[name] || null;
}

// Employee names come in two formats — "Hazar Kutuk" or "Chavez, Richy
// C" (Last, First Middle) — this pulls out just the first name either
// way, for a friendlier "Look who picked your order!" caption.
function firstNameOf(fullName) {
  if (fullName.includes(",")) {
    const afterComma = fullName.split(",")[1].trim();
    return afterComma.split(/\s+/)[0];
  }
  return fullName.split(/\s+/)[0];
}

const FLEET_TRACKER_URL = "https://hummusfit-fleet-tracker-production.up.railway.app";

// How long a driver realistically needs to unload at each stop before
// continuing to the next one — used to make ETAs actually accurate
// instead of just chaining raw drive times back to back. Adjust here if
// 18 minutes isn't the right number for your stops.
const UNLOAD_MINUTES_PER_STOP = 18;

// ================= DAY / STATE PERSISTENCE =================
function todayEasternFor(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
function todayEastern() {
  return todayEasternFor(new Date());
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
  return {
    day: todayEastern(),
    assignments: {},
    stopStatus: {},
    routeMeta: {},
    picking: {},
    deliveryWindowStart: getOrderWindowEastern(new Date()).windowStart.toISOString(),
    b2bLastResetDate: {},
  };
}

function loadState() {
  try {
    const state = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (state.day !== todayEastern()) {
      return defaultState();
    }
    if (!state.routeMeta) state.routeMeta = {}; // migrate older saved state
    if (!state.picking) state.picking = {}; // migrate older saved state
    if (!state.b2bLastResetDate) state.b2bLastResetDate = {}; // migrate older saved state

    const localRouteIds = new Set(ROUTES.map((r) => r.id));
    const b2bRouteIds = new Set(B2B_ROUTES.map((r) => r.id));

    // Delivery-side state (which van/driver is assigned, whether a route
    // has been started, live ETAs) only makes sense for whichever order
    // window is currently active. Without this, a route started at
    // 7:32am for this morning's deliveries would still show as "Live"
    // hours later even after the order window flips at noon and a
    // completely different set of orders/routes is being prepped —
    // exactly the stale-state bug this fixes. Picking records aren't
    // touched here since they already self-heal per-order via the
    // orderId check in getPickingRecord.
    //
    // This ONLY applies to local routes. B2B routes run 9-11+ hours and
    // are scheduled by day of week, not by this same-day noon window —
    // a Wednesday route starting at 4am could still be on the road well
    // past noon, and this reset would wipe its "Live" status, van, and
    // driver mid-route if it applied there too. B2B gets its own reset
    // below instead.
    const currentWindowStart = getOrderWindowEastern(new Date()).windowStart.toISOString();
    if (state.deliveryWindowStart !== currentWindowStart) {
      localRouteIds.forEach((id) => {
        delete state.assignments[id];
        delete state.stopStatus[id];
        delete state.routeMeta[id];
      });
      state.deliveryWindowStart = currentWindowStart;
      saveState(state);
    }

    // B2B: reset each route's own state once per calendar day, on its
    // own schedule — not tied to local's noon boundary at all. A route
    // only clears when today is genuinely a new day compared to the
    // last time THAT SPECIFIC route was reset, so a long-running route
    // that started this morning stays intact all day regardless of
    // local's order window flipping underneath it.
    const todayDateStr = todayEastern();
    let b2bChanged = false;
    b2bRouteIds.forEach((id) => {
      const route = B2B_ROUTES.find((r) => r.id === id);
      if (!route) return;
      // Always compare against the date of this route's CURRENT-OR-NEXT
      // scheduled occurrence (never a past one). This is what lets
      // someone assign a van/driver a day or two ahead of time — the
      // marker doesn't change again until that occurrence has actually
      // happened and passed, so an early assignment made Tuesday for a
      // Wednesday route survives all the way through Wednesday, and
      // only clears once Thursday confirms that cycle is over.
      const now = new Date();
      const todayDow = getEasternWeekday(now);
      const daysUntilNext = (route.day - todayDow + 7) % 7;
      const occurrenceDate = new Date(now);
      occurrenceDate.setDate(occurrenceDate.getDate() + daysUntilNext);
      const occurrenceDateStr = todayEasternFor(occurrenceDate);
      if (state.b2bLastResetDate[id] !== occurrenceDateStr) {
        delete state.assignments[id];
        delete state.stopStatus[id];
        delete state.routeMeta[id];
        state.b2bLastResetDate[id] = occurrenceDateStr;
        b2bChanged = true;
      }
    });
    if (b2bChanged) saveState(state);

    return state;
  } catch (e) {
    return defaultState();
  }
}
function saveState(state) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

app.get("/api/push-vapid-key", (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});
app.post("/api/push-subscribe", (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: "Invalid subscription" });
  }
  const subs = loadSubscriptions();
  // Same device subscribing again (browser can rotate the endpoint) —
  // replace rather than duplicate.
  const deduped = subs.filter((s) => s.endpoint !== subscription.endpoint);
  deduped.push(subscription);
  saveSubscriptions(deduped);
  res.json({ ok: true });
});
app.post("/api/push-unsubscribe", (req, res) => {
  const { endpoint } = req.body;
  const subs = loadSubscriptions().filter((s) => s.endpoint !== endpoint);
  saveSubscriptions(subs);
  res.json({ ok: true });
});
// Only Tony should be able to broadcast an announcement to every
// subscribed device. This is a small internal tool with no login
// system at all, so a shared PIN is the practical middle ground —
// but it's checked here, server-side, not just hidden in the UI,
// so it can't be bypassed by anyone calling the endpoint directly.
const ANNOUNCEMENT_ADMIN_PIN = "9310";

app.post("/api/push-send-manual", async (req, res) => {
  const { title, body, pin } = req.body;
  if (pin !== ANNOUNCEMENT_ADMIN_PIN) {
    return res.status(403).json({ error: "Incorrect PIN" });
  }
  if (!title || !body) {
    return res.status(400).json({ error: "title and body are both required" });
  }
  const subscriberCount = loadSubscriptions().length;
  await sendPushToAll({ title: title.trim(), body: body.trim(), icon: "/icon-192.png", url: "/" });
  res.json({ ok: true, sentTo: subscriberCount });
});

// Walks the whole product catalog and flags every variant with a
// blank SKU — since scanning depends entirely on that field matching
// the real barcode, this is the exact list of products that would
// hit the "no barcode on file" fallback and need to be picked
// manually instead of scanned.
let skuCoverageCache = { fetchedAt: 0, missing: [], totalVariants: 0 };
async function fetchSkuCoverage() {
  const now = Date.now();
  if (now - skuCoverageCache.fetchedAt < 5 * 60 * 1000) return skuCoverageCache;

  let missing = [];
  let totalVariants = 0;
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const query = `
      query($cursor: String) {
        products(first: 50, after: $cursor) {
          edges {
            cursor
            node {
              title
              status
              variants(first: 20) {
                edges { node { title sku } }
              }
            }
          }
          pageInfo { hasNextPage }
        }
      }
    `;
    const data = await shopifyGraphQL(query, { cursor });
    const edges = data.products.edges;
    edges.forEach((e) => {
      const product = e.node;
      if (product.status !== "ACTIVE") return; // skip archived/draft products — not relevant to today's picking
      product.variants.edges.forEach((ve) => {
        totalVariants++;
        const variant = ve.node;
        const hasRealVariant = variant.title && variant.title.toLowerCase() !== "default title";
        if (!variant.sku || !variant.sku.trim()) {
          missing.push({
            title: hasRealVariant ? `${product.title} — ${variant.title}` : product.title,
          });
        }
      });
    });
    hasNextPage = data.products.pageInfo.hasNextPage;
    cursor = edges.length ? edges[edges.length - 1].cursor : null;
    if (!edges.length) break;
  }

  skuCoverageCache = { fetchedAt: now, missing, totalVariants };
  return skuCoverageCache;
}
app.get("/api/sku-coverage", async (req, res) => {
  try {
    const result = await fetchSkuCoverage();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Read-only export for the separate Receiving Check app — exposes what
// was ACTUALLY picked (not just what was ordered) for a given stop's
// most recent completed order, so receiving can compare against real
// ground truth. Purely additive: doesn't change any existing behavior,
// just exposes data that already exists here.
app.get("/api/picked-summary/:stopName", async (req, res) => {
  try {
    const key = pickingKeyFor(decodeURIComponent(req.params.stopName));
    const cache = await fetchTodaysStopOrders();
    const order = cache.byStopName[key];
    const state = loadState();
    const liveRecord = order ? state.picking[key] : null;

    let record, orderName, isB2B, lineItems;
    if (liveRecord && order && liveRecord.orderId === order.orderId) {
      // Today's live data has it — the normal, same-day case.
      record = liveRecord;
      orderName = order.orderName;
      isB2B = Boolean(order.isB2B);
      lineItems = order.lineItems;
    } else {
      // Not in today's live data — either the calendar has moved past
      // midnight since this was picked, or the order fell out of
      // today's fetch window. Fall back to the permanent archive,
      // which was written the moment this order was actually finished
      // and never gets touched by the daily reset.
      const archive = loadArchive();
      const archived = archive[key];
      if (!archived) {
        return res.status(404).json({ error: "No completed order found for this stop yet." });
      }
      record = archived;
      orderName = archived.orderName;
      isB2B = archived.isB2B;
      lineItems = archived.lineItems;
    }

    const items = lineItems.map((item, idx) => {
      const status = record.itemStatus[idx] || "not_picked";
      const pickedQty =
        status === "picked" ? item.quantity :
        status === "partial" ? (record.itemPickedQty[idx] || 0) :
        0; // missing or not_picked
      return { title: item.title, sku: item.sku, expectedQty: item.quantity, pickedQty, status, imageUrl: item.imageUrl || null };
    });

    // Same crate-count logic used everywhere else in the app — closed
    // crates plus the currently-active one, if it actually has
    // anything in it. This is what tells receiving how many physical
    // boxes to expect for this delivery.
    const closedSet = new Set(record.closedCrates || []);
    const currentHasItems = Object.values(record.itemCrateNumber || {}).includes(record.currentCrateNumber);
    if (currentHasItems) closedSet.add(record.currentCrateNumber);
    const crateCount = closedSet.size;

    res.json({
      stopName: req.params.stopName,
      orderName: orderName,
      pickedBy: record.completedBy || record.pickedBy,
      completedAt: record.completedAt,
      isB2B: isB2B,
      crateCount,
      items,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/routes", (req, res) => {
  res.json({ routes: ROUTES, fleet: FLEET, drivers: DRIVERS, hq: HQ });
});
app.get("/api/b2b-routes-today", (req, res) => {
  const now = new Date();
  const todayDow = getEasternWeekday(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowDow = getEasternWeekday(tomorrow);
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // Real B2B orders come in days ahead of the actual delivery, so by
  // the time "today" rolls around a lot of tomorrow's picking could
  // already be doable — showing tomorrow's route here too (clearly
  // labeled, never confused with today's) lets the team get ahead
  // instead of only finding out what's coming once it's already today.
  const todaysRoutes = B2B_ROUTES.filter((r) => r.day === todayDow).map((r) => ({
    ...r,
    dayLabel: "Today — " + dayNames[todayDow],
  }));
  const tomorrowsRoutes = B2B_ROUTES.filter((r) => r.day === tomorrowDow).map((r) => ({
    ...r,
    dayLabel: "Tomorrow — " + dayNames[tomorrowDow],
  }));

  res.json({
    routes: todaysRoutes.concat(tomorrowsRoutes),
    allRoutes: B2B_ROUTES,
    drivers: DRIVERS,
    hq: HQ,
    todayDow,
  });
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
  if (!res.ok) {
    throw new Error(`Shopify API error: ${JSON.stringify(data.errors || data)}`);
  }
  if (data.errors && !data.data) {
    // No usable data at all — a genuine hard failure.
    throw new Error(`Shopify API error: ${JSON.stringify(data.errors)}`);
  }
  if (data.errors) {
    // Partial failure — GraphQL's normal behavior when one nested field
    // fails (like a missing permission on product images) while
    // everything else in the same request succeeds. Log it so it's
    // visible, but don't let one optional field break real order data
    // that came through fine.
    console.error("Shopify GraphQL partial error (continuing with partial data):", JSON.stringify(data.errors).slice(0, 300));
  }
  return data.data;
}

// In-memory cache, refreshed on demand (not every request)
let ordersCache = { fetchedAt: 0, byStopName: {}, windowStart: null, windowEnd: null };
const ORDERS_CACHE_MS = 60 * 1000; // 1 minute
let ordersRefreshInFlight = null;

// Stale-while-revalidate: a full refresh (Shopify local + B2B pulls, plus
// the blueprint lane fetch inside sortItemsForPicking) can take 5-10+
// seconds. Blocking a request on that is fine for the very first-ever
// load, but is exactly what was freezing the picker mid-crate-close —
// their click happened to land right as the 60s cache expired, so it sat
// waiting on a full cold refetch before the crate label could even start
// rendering. After the first successful fetch, always return the
// (possibly slightly stale) cache immediately and refresh in the
// background for the next request instead.
async function fetchTodaysStopOrders() {
  const now = Date.now();
  const isStale = now - ordersCache.fetchedAt >= ORDERS_CACHE_MS;
  const hasData = ordersCache.fetchedAt > 0;

  if (!isStale) {
    return ordersCache;
  }
  if (!hasData) {
    return refreshOrdersCache();
  }
  if (!ordersRefreshInFlight) {
    ordersRefreshInFlight = refreshOrdersCache()
      .catch((err) => {
        console.log(`Background orders refresh failed (serving stale data): ${err.message}`);
      })
      .finally(() => {
        ordersRefreshInFlight = null;
      });
  }
  return ordersCache;
}

async function refreshOrdersCache() {
  const now = Date.now();
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
              tags
              customer { tags }
              lineItems(first: 250) {
                edges {
                  node {
                    title
                    quantity
                    sku
                    variantTitle
                    variant { image { url } product { featuredImage { url } } }
                  }
                }
              }
            }
          }
          pageInfo { hasNextPage }
        }
      }
    `;
    const data = await shopifyGraphQL(query, {
      cursor,
      queryString: `created_at:>='${isoStart}' created_at:<='${isoEnd}' status:any -status:cancelled`,
    });

    const edges = data.orders.edges;
    orders = orders.concat(edges.map((e) => e.node));
    hasNextPage = data.orders.pageInfo.hasNextPage;
    cursor = edges.length ? edges[edges.length - 1].cursor : null;
    if (!edges.length) break;
  }

  const localGroupedByStop = {};
  orders.forEach((order) => {
    // Check BOTH the order's own tags and the customer's account-level
    // tags — a shared customer account (like PWRBLD, which places
    // orders for 3 different locations from one account) can still be
    // routed correctly by tagging the individual ORDER with the real
    // location, even when the customer-level tag alone can't tell the
    // locations apart.
    const tags = (order.tags || []).concat(order.customer?.tags || []).map((t) => t.trim());
    tags.forEach((tag) => {
      const key = tag.toLowerCase();
      // Only ever match a tag that's an actual real stop name from our
      // routes — ignore any other tag on the customer (marketing tags,
      // campaign names, unrelated labels, etc.)
      const stopMeta = VALID_STOP_NAMES.get(key);
      if (!stopMeta || stopMeta.isB2B) return; // B2B stops are handled separately below
      if (!localGroupedByStop[key]) localGroupedByStop[key] = [];
      localGroupedByStop[key].push(order);
    });
  });

  // Same reasoning as B2B: a store sometimes places a second or third
  // order the same day (an item was out of stock on the first order,
  // they added something after the fact, etc.) — every matching order
  // gets combined into one merged pick list instead of only keeping the
  // first one found, so nothing a picker needs is ever silently missed.
  const localByStopName = {};
  for (const key of Object.keys(localGroupedByStop)) {
    const stopOrders = localGroupedByStop[key];
    const mergedItemsByKey = {};
    stopOrders.forEach((order) => {
      order.lineItems.edges.forEach((e) => {
        const node = e.node;
        const hasRealVariant =
          node.variantTitle && node.variantTitle.toLowerCase() !== "default title";
        const title = hasRealVariant ? `${node.title} — ${node.variantTitle}` : node.title;
        const itemKey = title + "::" + (node.sku || "");
        const imageUrl = (node.variant && (node.variant.image?.url || node.variant.product?.featuredImage?.url)) || null;
        if (mergedItemsByKey[itemKey]) {
          mergedItemsByKey[itemKey].quantity += node.quantity;
        } else {
          mergedItemsByKey[itemKey] = { title, quantity: node.quantity, sku: node.sku, imageUrl };
        }
      });
    });
    // A stable id that only changes when the actual SET of orders for
    // this stop changes — adding a new (e.g. backordered-item) order
    // correctly resets/expands the picking record, but re-syncing the
    // same set of orders never wipes progress already made.
    const sortedIds = stopOrders.map((o) => o.id).sort();
    localByStopName[key] = {
      orderId: sortedIds.join(","),
      orderName: stopOrders.map((o) => o.name).join(", "),
      orderCount: stopOrders.length,
      createdAt: stopOrders.map((o) => o.createdAt).sort()[0],
      lineItems: await sortItemsForPicking(Object.values(mergedItemsByKey)),
      isB2B: false,
    };
  }

  const byStopName = Object.assign({}, localByStopName, await fetchB2BStopOrders());
  ordersCache = { fetchedAt: now, byStopName, windowStart, windowEnd };
  return ordersCache;
}

// B2B customers order on their own schedule — sometimes days ahead of an
// actual delivery, sometimes with more than one separate order for the
// same upcoming stop. Local's narrow same-day window and "first order
// wins" logic would silently miss or drop real orders for these stops,
// so B2B gets its own fetch: pull anything still unfulfilled within a
// generous lookback, and combine every matching order for a stop into
// one merged pick list instead of keeping only the first.
// A shared customer account (like PWRBLD or Ares, which order for
// several different physical locations from one account) can't be told
// apart by customer-level tags alone — but the order's own shipping
// address already has to be correct for the package to actually reach
// the right place. So build a zip-code lookup from every known B2B
// stop's address, and use it to auto-identify which location an
// untagged shared-account order is actually for, removing the need to
// manually tag every single order by hand.
const B2B_ZIP_TO_STOP = new Map();
B2B_ROUTES.forEach((route) => {
  route.stops.forEach((s) => {
    const zipMatch = (s.address || "").match(/\b(\d{5})\b(?!.*\d{5})/);
    if (zipMatch) B2B_ZIP_TO_STOP.set(zipMatch[1], s.name.toLowerCase());
  });
});

const B2B_LOOKBACK_DAYS = 21;
async function fetchB2BStopOrders() {
  const lookbackStart = new Date(Date.now() - B2B_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
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
              tags
              customer { tags }
              shippingAddress { zip }
              lineItems(first: 250) {
                edges {
                  node {
                    title
                    quantity
                    sku
                    variantTitle
                    variant { image { url } product { featuredImage { url } } }
                  }
                }
              }
            }
          }
          pageInfo { hasNextPage }
        }
      }
    `;
    const data = await shopifyGraphQL(query, {
      cursor,
      queryString: `created_at:>='${lookbackStart}' fulfillment_status:unfulfilled status:any -status:cancelled`,
    });
    const edges = data.orders.edges;
    orders = orders.concat(edges.map((e) => e.node));
    hasNextPage = data.orders.pageInfo.hasNextPage;
    cursor = edges.length ? edges[edges.length - 1].cursor : null;
    if (!edges.length) break;
  }

  // Group every matching order per stop, then merge them into one
  // combined pick list — summing quantities for the same item across
  // orders rather than keeping separate lines, since a picker needs
  // "how many total," not an order-by-order breakdown.
  const groupedByStop = {};
  orders.forEach((order) => {
    // Same as local: check the order's own tags too, not just the
    // customer's — this is what lets PWRBLD's one shared account place
    // orders for 3 different locations and still have each order route
    // to the correct one, by tagging the individual order.
    const tags = (order.tags || []).concat(order.customer?.tags || []).map((t) => t.trim());
    let matchedAny = false;
    tags.forEach((tag) => {
      const key = tag.toLowerCase();
      const stopMeta = VALID_STOP_NAMES.get(key);
      if (!stopMeta || !stopMeta.isB2B) return;
      matchedAny = true;
      if (!groupedByStop[key]) groupedByStop[key] = [];
      groupedByStop[key].push(order);
    });
    // No tag identified a real stop — this is exactly the shared-account
    // situation (PWRBLD, Ares) where the order wasn't individually
    // tagged. Rather than lose the order entirely, fall back to the
    // real shipping address already on it: the package has to go to
    // the right place regardless, so that address is a reliable way to
    // auto-identify which known stop this order is actually for.
    if (!matchedAny) {
      const zip = order.shippingAddress?.zip;
      const fallbackKey = zip ? B2B_ZIP_TO_STOP.get(zip) : null;
      if (fallbackKey) {
        if (!groupedByStop[fallbackKey]) groupedByStop[fallbackKey] = [];
        groupedByStop[fallbackKey].push(order);
      }
    }
  });

  const byStopName = {};
  for (const key of Object.keys(groupedByStop)) {
    const stopOrders = groupedByStop[key];
    const mergedItemsByKey = {}; // "title::sku" -> combined item
    stopOrders.forEach((order) => {
      order.lineItems.edges.forEach((e) => {
        const node = e.node;
        const hasRealVariant =
          node.variantTitle && node.variantTitle.toLowerCase() !== "default title";
        const title = hasRealVariant ? `${node.title} — ${node.variantTitle}` : node.title;
        const itemKey = title + "::" + (node.sku || "");
        const imageUrl = (node.variant && (node.variant.image?.url || node.variant.product?.featuredImage?.url)) || null;
        if (mergedItemsByKey[itemKey]) {
          mergedItemsByKey[itemKey].quantity += node.quantity;
        } else {
          mergedItemsByKey[itemKey] = { title, quantity: node.quantity, sku: node.sku, imageUrl };
        }
      });
    });
    // A stable id that only changes when the actual SET of orders for
    // this stop changes — adding a new order correctly resets/expands
    // the picking record, but re-syncing the same set of orders never
    // wipes progress already made.
    const sortedIds = stopOrders.map((o) => o.id).sort();
    byStopName[key] = {
      orderId: sortedIds.join(","),
      orderName: stopOrders.map((o) => o.name).join(", "),
      orderCount: stopOrders.length,
      createdAt: stopOrders.map((o) => o.createdAt).sort()[0],
      lineItems: await sortItemsForPicking(Object.values(mergedItemsByKey)),
      isB2B: true,
    };
  }
  return byStopName;
}

app.get("/api/today-orders", async (req, res) => {
  const now = new Date();
  const scheduledToday = {};
  VALID_STOP_NAMES.forEach((meta, key) => {
    scheduledToday[key] = isStopScheduledToday(meta, now);
  });
  try {
    const cache = await fetchTodaysStopOrders();
    const state = loadState();
    const pickingStatus = {};
    Object.keys(cache.byStopName).forEach((key) => {
      const order = cache.byStopName[key];
      const record = state.picking[key];
      if (!record || record.orderId !== order.orderId) {
        pickingStatus[key] = { status: "not_started", crateCount: 0 };
        return;
      }
      // How many distinct crates exist for this order so far — closed
      // ones plus whichever one is currently active, if it actually has
      // anything in it. This is what tells a driver how many physical
      // boxes to expect/load for this stop.
      const closedSet = new Set(record.closedCrates || []);
      const currentHasItems = Object.values(record.itemCrateNumber || {}).includes(record.currentCrateNumber);
      if (currentHasItems) closedSet.add(record.currentCrateNumber);
      const crateCount = closedSet.size;

      if (record.completedAt) {
        pickingStatus[key] = {
          status: "completed",
          pickedBy: record.completedBy,
          startedAt: record.startedAt,
          completedAt: record.completedAt,
          crateCount,
        };
        return;
      }
      const statuses = Object.values(record.itemStatus || {});
      const addressedCount = statuses.filter((s) => s !== "not_picked").length;
      const totalItems = order.lineItems.length;
      const percent = totalItems > 0 ? Math.round((addressedCount / totalItems) * 100) : 0;
      const anyTouched = statuses.length > 0;
      if (record.pickedBy || anyTouched) {
        pickingStatus[key] = { status: "in_progress", pickedBy: record.pickedBy, percent, crateCount };
        return;
      }
      pickingStatus[key] = { status: "not_started", crateCount: 0 };
    });
    res.json({
      byStopName: cache.byStopName,
      windowStart: cache.windowStart,
      windowEnd: cache.windowEnd,
      scheduledToday,
      pickingStatus,
      configured: Boolean(SHOP_DOMAIN && SHOPIFY_TOKEN),
    });
  } catch (err) {
    res.json({ byStopName: {}, scheduledToday, pickingStatus: {}, configured: false, error: err.message });
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
    const pickingState = loadState();
    const pickingRecord = pickingState.picking[key];

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${order.orderName}-packing-slip.pdf"`);

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    const checkboxX = 50;
    const qtyX = 95;
    const itemX = 130;
    const itemWidth = 250;
    const locationX = 388;
    const locationWidth = 155;
    const boxSize = 14;
    const BRAND_ORANGE = "#E8612C";
    const INK_DARK = "#222222";
    const ZEBRA_TINT = "#F3F3F1";

    const laneIndex = await loadLocationIndex();
    // Non-fridge supply items (paper goods, plastic goods, spoons, garbage
    // bags, etc.) live on the other side of the building from the fridge/
    // backstock area, and will never appear in the blueprint lane feed —
    // they need to sort dead last, AFTER food items that just haven't been
    // wired into the blueprint yet (like Overnight Oats/snacks, which are
    // real fridge items the live lanes API doesn't track). Without this,
    // both groups fell into the same "unmatched" bucket and got shuffled
    // together at the bottom.
    const SUPPLY_KEYWORDS = /\b(spoon|fork|knife|utensil|napkin|garbage bag|trash bag|paper|plastic|cup|lid|straw|sleeve|packaging|hoodie|apparel|gift card|crop hoodie)\b/i;
    const itemsWithMeta = order.lineItems.map((item, originalIdx) => ({
      item,
      originalIdx,
      location: findLocation(laneIndex, item.title),
      isSupply: SUPPLY_KEYWORDS.test(item.title),
    }));
    const UNMATCHED_SORT_KEY = [999, "ZZZ", 999, 999];
    itemsWithMeta.sort((a, b) => {
      const tierA = a.location ? 0 : a.isSupply ? 2 : 1;
      const tierB = b.location ? 0 : b.isSupply ? 2 : 1;
      if (tierA !== tierB) return tierA - tierB;
      if (tierA === 0) {
        const ka = a.location.sortKey;
        const kb = b.location.sortKey;
        for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
          const av = ka[i] === undefined ? 0 : ka[i];
          const bv = kb[i] === undefined ? 0 : kb[i];
          if (av < bv) return -1;
          if (av > bv) return 1;
        }
        return 0;
      }
      // Both unmatched-food or both supplies: alphabetical within the tier.
      return a.item.title.localeCompare(b.item.title);
    });
    const unmatchedTitles = itemsWithMeta.filter((m) => !m.location).map((m) => m.item.title);

    function drawColumnHeaders() {
      const headerY = doc.y;
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#8A8580");
      doc.text("PICKED", checkboxX, headerY, { width: 40, lineBreak: false });
      doc.text("QTY", qtyX, headerY, { width: 30, lineBreak: false });
      doc.text("ITEM", itemX, headerY, { lineBreak: false });
      doc.text("WALK-IN LOCATION", locationX, headerY, { width: locationWidth, lineBreak: false });
      doc.y = headerY + 16;
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(INK_DARK).lineWidth(1).stroke();
      doc.y += 10;
    }

    const pageUsableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const stopNameUpper = req.params.stopName.toUpperCase();

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

    itemsWithMeta.forEach(({ item, originalIdx, location }, idx) => {
      const itemStatus = pickingRecord && pickingRecord.itemStatus ? pickingRecord.itemStatus[originalIdx] : undefined;
      const isPartial = itemStatus === "partial";
      const pickedQty = isPartial && pickingRecord.itemPickedQty ? pickingRecord.itemPickedQty[originalIdx] : undefined;
      const qtyLabel = isPartial && pickedQty !== undefined ? `${pickedQty}/${item.quantity}` : String(item.quantity);
      const displayTitle = isPartial ? `${item.title} (SHORT)` : item.title;
      const locationLabel = location ? location.laneLabel : "\u2014 NOT ON FILE \u2014";

      const textHeight = Math.max(
        doc.heightOfString(displayTitle, { width: itemWidth, fontSize: 11 }),
        doc.heightOfString(locationLabel, { width: locationWidth, fontSize: 10 })
      );
      const estimatedRowHeight = Math.max(boxSize + 8, textHeight + 8);

      if (doc.y + estimatedRowHeight > pageBottom) {
        doc.addPage();
        doc.y = 50;
        drawColumnHeaders();
      }

      const rowY = doc.y;

      if (idx % 2 === 1) {
        doc.rect(46, rowY - 3, 503, estimatedRowHeight).fill(ZEBRA_TINT);
      }

      doc
        .rect(checkboxX, rowY, boxSize, boxSize)
        .lineWidth(1.4)
        .strokeColor(INK_DARK)
        .stroke();

      doc.fontSize(11).fillColor("#111111");
      doc.text(qtyLabel, qtyX, rowY + 1, { width: 30 });
      doc.text(displayTitle, itemX, rowY + 1, { width: itemWidth });

      doc.font("Helvetica-Bold").fontSize(10).fillColor(location ? BRAND_ORANGE : "#B23A2E");
      doc.text(locationLabel, locationX, rowY + 1, { width: locationWidth });
      doc.font("Helvetica").fillColor("#111111");

      const afterTextY = doc.y;
      const rowHeight = Math.max(boxSize + 6, afterTextY - rowY + 6, estimatedRowHeight);
      doc.y = rowY + rowHeight;
    });

    // Reserve real room for the divider, total-items line, and the
    // unmatched-location warning (if any) before drawing them — measured
    // with heightOfString instead of a flat guess, so this footer can
    // never silently run off the bottom of the page the way the original
    // 50-item cutoff bug did. Previously this warning line could get cut
    // off with no page break, silently dropping items from the list.
    const totalItems = order.lineItems.reduce((sum, i) => sum + i.quantity, 0);
    const totalItemsText = `Total items: ${totalItems}`;
    const unmatchedText = unmatchedTitles.length
      ? `No walk-in location on file for: ${unmatchedTitles.join(", ")}`
      : null;

    let footerHeight = 10 + doc.heightOfString(totalItemsText, { width: pageUsableWidth, fontSize: 10 }) + 10;
    if (unmatchedText) {
      footerHeight += 6 + doc.heightOfString(unmatchedText, { width: pageUsableWidth, fontSize: 9 });
    }

    if (doc.y + footerHeight > pageBottom) {
      doc.addPage();
      doc.y = 50;
    }

    doc.moveDown(0.8);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#dddddd").stroke();
    doc.moveDown(0.5);

    doc.fontSize(10).fillColor("#666666").text(totalItemsText, 50, doc.y, { width: pageUsableWidth });

    if (unmatchedText) {
      doc.moveDown(0.4);
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#B23A2E")
        .text(unmatchedText, 50, doc.y, { width: pageUsableWidth });
      doc.font("Helvetica");
    }

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
      itemStatus: {}, // index -> 'not_picked' | 'picked' | 'missing' | 'partial'
      itemNotes: {}, // index -> free text reason
      itemPickedQty: {}, // index -> actual quantity picked (only meaningful for 'partial')
      itemScannedCount: {}, // index -> how many individual units have actually been scanned so far
      itemCrateNumber: {}, // index -> which crate this item was physically packed into
      currentCrateNumber: 1, // crate currently being filled; increments via "New Crate"
      closedCrates: [], // list of crate numbers already closed out (label already printed)
      pickedBy: null, // employee name working this order
      startedAt: null, // set once, the first moment picking actually begins
      completedAt: null, // set once Finish Order succeeds
      completedBy: null,
    };
  }
  if (!state.picking[key].itemPickedQty) state.picking[key].itemPickedQty = {}; // migrate older records
  if (!state.picking[key].itemScannedCount) state.picking[key].itemScannedCount = {};
  if (!state.picking[key].itemCrateNumber) state.picking[key].itemCrateNumber = {};
  if (!state.picking[key].currentCrateNumber) state.picking[key].currentCrateNumber = 1;
  if (!state.picking[key].closedCrates) state.picking[key].closedCrates = [];
  if (state.picking[key].startedAt === undefined) state.picking[key].startedAt = null;
  return state.picking[key];
}

// Finds which route a given stop belongs to, and that route's display
// name — used on crate labels so a driver can see "Route #1" at a glance.
function routeInfoForStop(stopName) {
  const key = stopName.toLowerCase();
  for (const route of ROUTES) {
    if (route.stops.some((s) => s.name.toLowerCase() === key)) {
      return { routeName: route.name, routeTime: route.time };
    }
  }
  return { routeName: "", routeTime: "" };
}

// Every real stop across every route, in a fixed order — this is the
// full known universe of stores we ever print labels for.
const ALL_STOP_NAMES = ROUTES.flatMap((route) => route.stops.map((s) => s.name));

const CRATE_PATTERN_TYPES = ["diagonal", "dots", "crosshatch", "chevron", "vertical", "horizontal", "brick", "waves"];

// Builds a genuinely unique visual identity (a monogram + a fill pattern)
// for every store, guaranteed never to collide — two stores sharing a
// first letter automatically get a two-letter monogram instead, and if
// that ever collides too, a number gets appended. This is what makes
// every store's crate label look different at a glance, not just have
// different text.
function buildStoreIdentities(allStopNames) {
  const identities = {};
  const firstLetterCount = {};
  allStopNames.forEach((name) => {
    const letter = name.trim().charAt(0).toUpperCase();
    firstLetterCount[letter] = (firstLetterCount[letter] || 0) + 1;
  });

  allStopNames.forEach((name, idx) => {
    const trimmed = name.trim();
    const firstLetter = trimmed.charAt(0).toUpperCase();
    let monogram;
    if (firstLetterCount[firstLetter] === 1) {
      monogram = firstLetter;
    } else {
      const words = trimmed.split(/\s+/);
      monogram =
        words.length > 1
          ? (words[0].charAt(0) + words[1].charAt(0)).toUpperCase()
          : trimmed.slice(0, 2).toUpperCase();
    }
    identities[name.toLowerCase()] = {
      monogram,
      pattern: CRATE_PATTERN_TYPES[idx % CRATE_PATTERN_TYPES.length],
      index: idx,
    };
  });

  const seenMonograms = {};
  Object.keys(identities).forEach((key) => {
    const id = identities[key];
    if (seenMonograms[id.monogram]) {
      id.monogram = id.monogram + (id.index + 1);
    }
    seenMonograms[id.monogram] = true;
  });

  return identities;
}

const STORE_IDENTITIES = buildStoreIdentities(ALL_STOP_NAMES);

function storeIdentityFor(stopName) {
  return (
    STORE_IDENTITIES[stopName.toLowerCase()] || {
      monogram: stopName.trim().charAt(0).toUpperCase(),
      pattern: "diagonal",
    }
  );
}

// Draws one of the 8 black-ink-only fill patterns into a rectangular
// area — this is what gives each store's label a distinct "texture,"
// readable even on a printer with zero color capability.
function drawPattern(doc, pattern, x, y, width, height) {
  doc.save();
  doc.rect(x, y, width, height).clip();
  doc.fillColor("#111111").strokeColor("#111111");

  if (pattern === "diagonal") {
    for (let i = -height; i < width; i += 10) {
      doc.moveTo(x + i, y + height).lineTo(x + i + height, y).lineWidth(2.5).stroke();
    }
  } else if (pattern === "dots") {
    for (let dy = 6; dy < height; dy += 12) {
      for (let dx = 6; dx < width; dx += 12) {
        doc.circle(x + dx, y + dy, 2.2).fill();
      }
    }
  } else if (pattern === "crosshatch") {
    for (let i = -height; i < width; i += 12) {
      doc.moveTo(x + i, y + height).lineTo(x + i + height, y).lineWidth(1.3).stroke();
      doc.moveTo(x + i, y).lineTo(x + i + height, y + height).lineWidth(1.3).stroke();
    }
  } else if (pattern === "chevron") {
    for (let cy = y; cy < y + height; cy += 10) {
      for (let cx = x; cx < x + width; cx += 16) {
        doc.moveTo(cx, cy + 8).lineTo(cx + 8, cy).lineTo(cx + 16, cy + 8).lineWidth(2).stroke();
      }
    }
  } else if (pattern === "vertical") {
    for (let i = x; i < x + width; i += 9) {
      doc.moveTo(i, y).lineTo(i, y + height).lineWidth(3).stroke();
    }
  } else if (pattern === "horizontal") {
    for (let i = y; i < y + height; i += 9) {
      doc.moveTo(x, i).lineTo(x + width, i).lineWidth(3).stroke();
    }
  } else if (pattern === "brick") {
    let row = 0;
    for (let by = y; by < y + height; by += 10) {
      const offset = row % 2 === 0 ? 0 : 12;
      for (let bx = x - 12; bx < x + width; bx += 24) {
        doc.rect(bx + offset, by, 20, 8).lineWidth(1.3).stroke();
      }
      row++;
    }
  } else if (pattern === "waves") {
    for (let wy = y; wy < y + height + 10; wy += 10) {
      doc.moveTo(x, wy);
      for (let wx = x; wx < x + width; wx += 10) {
        doc.quadraticCurveTo(wx + 5, wy - 5, wx + 10, wy);
      }
      doc.lineWidth(1.6).stroke();
    }
  }

  doc.restore();
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
      itemPickedQty: record.itemPickedQty,
      itemScannedCount: record.itemScannedCount,
      itemCrateNumber: record.itemCrateNumber,
      currentCrateNumber: record.currentCrateNumber,
      closedCrates: record.closedCrates,
      isB2B: Boolean(order.isB2B),
      pickedBy: record.pickedBy,
      pickedByPhoto: record.pickedBy ? pickerPhotoFor(record.pickedBy) : null,
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
    const { stopName, itemIndex, status, note, pickedQty } = req.body;
    if (!stopName || itemIndex === undefined || !status) {
      return res.status(400).json({ error: "stopName, itemIndex, and status required" });
    }
    const cache = await fetchTodaysStopOrders();
    const key = pickingKeyFor(stopName);
    const order = cache.byStopName[key];
    if (!order) return res.status(404).json({ error: "No order found for this stop." });

    const state = loadState();
    const record = getPickingRecord(state, key, order);
    if (!record.startedAt) {
      record.startedAt = new Date().toISOString();
    }
    record.itemStatus[itemIndex] = status;
    if (note !== undefined) {
      record.itemNotes[itemIndex] = note;
    }
    if (status === "partial") {
      if (pickedQty === undefined) {
        return res.status(400).json({ error: "pickedQty required when status is partial" });
      }
      record.itemPickedQty[itemIndex] = pickedQty;
      record.itemScannedCount[itemIndex] = pickedQty;
    } else {
      // Clear any stale partial-quantity value once the item is no longer partial
      delete record.itemPickedQty[itemIndex];
      if (status === "picked") {
        // Manually tapped fully picked (not via scanning) — treat as
        // fully accounted for so a later scan doesn't re-open it.
        const itemQty = order.lineItems[itemIndex] ? order.lineItems[itemIndex].quantity : 0;
        record.itemScannedCount[itemIndex] = itemQty;
      } else if (status === "not_picked") {
        // Cycled back to the start — clear scan progress so a fresh
        // scan-count cycle can begin cleanly.
        delete record.itemScannedCount[itemIndex];
      }
    }
    if (status === "picked" || status === "partial") {
      // Physically going into a box right now — tag it with whichever
      // crate is currently active.
      record.itemCrateNumber[itemIndex] = record.currentCrateNumber;
    } else {
      // Missing/not_picked items never go in a physical crate
      delete record.itemCrateNumber[itemIndex];
    }
    saveState(state);
    res.json({
      ok: true,
      itemStatus: record.itemStatus,
      itemNotes: record.itemNotes,
      itemPickedQty: record.itemPickedQty,
      itemScannedCount: record.itemScannedCount,
      itemCrateNumber: record.itemCrateNumber,
      currentCrateNumber: record.currentCrateNumber,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A single barcode scan represents ONE physical unit — not the whole
// line item. This increments a per-item running count and only marks
// the item fully "picked" once the scanned count reaches the actual
// ordered quantity. This is what makes scanning genuinely verify a
// count, not just verify "yes, this is the right product."
app.post("/api/picking-scan", async (req, res) => {
  try {
    const { stopName, scannedCode } = req.body;
    if (!stopName || !scannedCode) {
      return res.status(400).json({ error: "stopName and scannedCode required" });
    }
    const cache = await fetchTodaysStopOrders();
    const key = pickingKeyFor(stopName);
    const order = cache.byStopName[key];
    if (!order) return res.status(404).json({ error: "No order found for this stop." });

    const state = loadState();
    const record = getPickingRecord(state, key, order);
    // A scan with nobody assigned means it either happened before the
    // picker chose their name, or the client's local state is stale — in
    // both cases the scan should not silently count, and the picker
    // needs a clear signal (not just nothing visibly happening).
    if (!record.pickedBy) {
      return res.json({ ok: true, matched: false, needsPicker: true });
    }
    if (!record.startedAt) {
      record.startedAt = new Date().toISOString();
    }

    const code = scannedCode.trim();
    let matchIdx = -1;
    for (let i = 0; i < order.lineItems.length; i++) {
      const item = order.lineItems[i];
      const sku = (item.sku || "").trim();
      const currentStatus = record.itemStatus[i] || "not_picked";
      const scannedSoFar = record.itemScannedCount[i] || 0;
      const alreadyResolved = currentStatus === "picked" || currentStatus === "missing" || currentStatus === "partial";
      if (sku && sku === code && !alreadyResolved && scannedSoFar < item.quantity) {
        matchIdx = i;
        break;
      }
    }

    if (matchIdx === -1) {
      const alreadyResolvedMatch = order.lineItems.some((item, i) => {
        const sku = (item.sku || "").trim();
        const s = record.itemStatus[i] || "not_picked";
        return sku === code && (s === "picked" || s === "missing" || s === "partial");
      });
      saveState(state);
      return res.json({ ok: true, matched: false, alreadyResolved: alreadyResolvedMatch });
    }

    const item = order.lineItems[matchIdx];
    record.itemScannedCount[matchIdx] = (record.itemScannedCount[matchIdx] || 0) + 1;
    const scannedNow = record.itemScannedCount[matchIdx];
    // Tag this item with the active crate as soon as the FIRST unit is
    // scanned, not just once the whole line item is fully accounted
    // for. Physically, the item is already going into the box the
    // moment it's scanned — a multi-unit item (e.g. 5 of 25 scanned so
    // far) is genuinely sitting in the current crate right now, and the
    // "New Crate" button's running unit count needs to see that. Only
    // setting this on full completion was why scanning a large-quantity
    // item never moved the crate badge until every last unit was done.
    if (!record.itemCrateNumber[matchIdx]) {
      record.itemCrateNumber[matchIdx] = record.currentCrateNumber;
    }
    let newStatus = "not_picked";
    if (scannedNow >= item.quantity) {
      newStatus = "picked";
    }
    record.itemStatus[matchIdx] = newStatus;
    saveState(state);

    res.json({
      ok: true,
      matched: true,
      itemIndex: matchIdx,
      itemTitle: item.title,
      scannedCount: scannedNow,
      totalQty: item.quantity,
      status: newStatus,
      itemStatus: record.itemStatus,
      itemScannedCount: record.itemScannedCount,
      itemCrateNumber: record.itemCrateNumber,
      currentCrateNumber: record.currentCrateNumber,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Closes out the crate currently being filled (marking it ready for its
// label to print) and starts tracking a fresh crate for whatever gets
// picked next. Returns the closed crate's number so the frontend can
// immediately open that crate's label PDF.
app.post("/api/picking-new-crate", async (req, res) => {
  try {
    const { stopName } = req.body;
    if (!stopName) return res.status(400).json({ error: "stopName required" });
    const cache = await fetchTodaysStopOrders();
    const key = pickingKeyFor(stopName);
    const order = cache.byStopName[key];
    if (!order) return res.status(404).json({ error: "No order found for this stop." });

    const state = loadState();
    const record = getPickingRecord(state, key, order);

    const closedCrateNumber = record.currentCrateNumber;
    const hasItemsInCrate = Object.values(record.itemCrateNumber).includes(closedCrateNumber);
    if (!hasItemsInCrate) {
      return res.status(400).json({ error: "This crate is empty — pick at least one item before starting a new crate." });
    }

    record.closedCrates.push(closedCrateNumber);
    record.currentCrateNumber = closedCrateNumber + 1;
    saveState(state);
    res.json({ ok: true, closedCrateNumber, currentCrateNumber: record.currentCrateNumber });
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
    if (picker && !record.startedAt) {
      record.startedAt = new Date().toISOString();
    }
    saveState(state);
    res.json({ ok: true, pickedBy: record.pickedBy, pickedByPhoto: record.pickedBy ? pickerPhotoFor(record.pickedBy) : null });
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

    // Auto-close whatever crate was still active — every crate gets a
    // label by the time the order is finished, including the last one,
    // even if the picker never explicitly tapped "New Crate" for it.
    const finalCrateNumber = record.currentCrateNumber;
    const finalCrateHasItems = Object.values(record.itemCrateNumber).includes(finalCrateNumber);
    if (finalCrateHasItems && !record.closedCrates.includes(finalCrateNumber)) {
      record.closedCrates.push(finalCrateNumber);
    }

    record.completedAt = new Date().toISOString();
    record.completedBy = record.pickedBy;
    saveState(state);
    archiveCompletedOrder(key, record, order);
    res.json({
      ok: true,
      completedAt: record.completedAt,
      completedBy: record.completedBy,
      finalCrateNumber: finalCrateHasItems ? finalCrateNumber : null,
      closedCrates: record.closedCrates,
    });
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
    const liveRecord = state.picking[key];
    const alreadyHasRealData = liveRecord && liveRecord.orderId === order.orderId && liveRecord.completedAt;

    if (!alreadyHasRealData) {
      // Today's live record doesn't actually have this order's real
      // completed work — most likely the day changed since it was
      // finished, and the daily reset already wiped it. Without this
      // check, "reopening" here would silently create a brand new
      // blank record instead of recovering what was really picked,
      // which is exactly what happened before this fix.
      const archive = loadArchive();
      const archived = archive[key];
      if (archived && archived.orderId === order.orderId) {
        state.picking[key] = { ...archived, completedAt: null, completedBy: null };
        saveState(state);
        return res.json({ ok: true, restoredFromArchive: true });
      }
      // No archive match either — genuinely nothing to reopen, so seed
      // a fresh record rather than pretending old data exists.
    }

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
// Generates a small 4x6" label for one specific crate — route number,
// store name (big, this is what stops a driver from dropping the wrong
// crate at the wrong store), order number, crate number, and only the
// items actually packed into THAT crate.
app.get("/api/crate-label/:stopName/:crateNumber", async (req, res) => {
  try {
    const cache = await fetchTodaysStopOrders();
    const key = pickingKeyFor(decodeURIComponent(req.params.stopName));
    const order = cache.byStopName[key];
    if (!order) return res.status(404).send("No order found for this stop.");

    const crateNumber = parseInt(req.params.crateNumber, 10);
    const state = loadState();
    const record = getPickingRecord(state, key, order);

    const crateItems = order.lineItems
      .map((item, idx) => {
        if (record.itemCrateNumber[idx] !== crateNumber) return null;
        const itemStatusNow = record.itemStatus[idx];
        // itemCrateNumber now gets tagged on the FIRST scanned unit (see
        // /api/picking-scan), not just once an item is fully picked — so
        // a crate can legitimately close while one of its items is still
        // mid-scan (e.g. 5 of 25 units). The label has to print what's
        // actually physically in the box: the full ordered quantity for
        // a completed item, the recorded short-count for an explicit
        // partial, or the real running scanned count for anything still
        // in progress — never the full quantity for an item that isn't
        // actually all there yet.
        const qty =
          itemStatusNow === "partial" ? record.itemPickedQty[idx] :
          itemStatusNow === "picked" ? item.quantity :
          record.itemScannedCount[idx] || 0;
        return { title: item.title, quantity: qty };
      })
      .filter((item) => item !== null);

    if (crateItems.length === 0) {
      return res.status(404).send("No items found in this crate.");
    }

    const { routeName } = routeInfoForStop(req.params.stopName);
    const stopNameUpper = decodeURIComponent(req.params.stopName).toUpperCase();
    const identity = storeIdentityFor(decodeURIComponent(req.params.stopName));

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${order.orderName}-crate${crateNumber}-label.pdf"`
    );

    // Standard 4x6" shipping label size (288 x 432 points)
    const doc = new PDFDocument({ size: [288, 432], margin: 0 });
    doc.pipe(res);

    const M = 16; // inner margin
    const usableWidth = 288 - M * 2;

    // A real printed border frame — the single biggest reason the old
    // label read as "empty": edge-to-edge whitespace with no structure.
    // A thermal printer can't do color, but it can absolutely do a
    // clean rule, and a bordered card is what makes this look like an
    // intentional, designed label instead of a debug printout.
    doc.rect(6, 6, 288 - 12, 432 - 12).lineWidth(1.25).strokeColor("#111111").stroke();

    // Pattern band — the quick visual "fingerprint" per store that lets
    // someone recognize their store's label from across a van without
    // reading it. Kept exactly as-is; it already earned its place.
    drawPattern(doc, identity.pattern, 6, 6, 288 - 12, 13);
    doc.moveTo(6, 19).lineTo(288 - 6, 19).strokeColor("#111111").lineWidth(1).stroke();

    // Header row: monogram + route on the left (fast store ID at a
    // glance), the real Hummus Fit logo on the right — this is the part
    // that was missing entirely before. A black-ink silhouette version
    // made specifically for thermal printing, not the color web logo.
    const headerY = 19 + 10;
    const badgeCenterX = M + 13;
    const badgeCenterY = headerY + 13;
    doc.circle(badgeCenterX, badgeCenterY, 13).fill("#111111");
    const monogramSize = identity.monogram.length > 1 ? 10 : 13;
    doc.font("Helvetica-Bold").fontSize(monogramSize).fillColor("#FFFFFF");
    const monoWidth = doc.widthOfString(identity.monogram);
    doc.text(identity.monogram, badgeCenterX - monoWidth / 2, badgeCenterY - monogramSize / 2 + 1);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#666666")
      .text((routeName || "HUMMUS FIT").toUpperCase(), badgeCenterX + 20, badgeCenterY - 4, { width: 110 });

    // Logo aspect ratio is 370:100 — 66pt wide keeps it crisp without
    // dominating the header row.
    const logoWidth = 66;
    const logoHeight = logoWidth * (100 / 370);
    try {
      doc.image(LOGO_BLACK_PATH, 288 - M - logoWidth, headerY, { width: logoWidth, height: logoHeight });
    } catch (e) {
      /* Missing logo file shouldn't ever block a label from printing */
    }

    // STORE NAME — the dominant, full-width element. Every real store
    // name renders between 20-44pt depending on length, tested against
    // all 16 real store names, so it's legible from across a van.
    doc.y = headerY + 30 + 8;
    const stopFontSize = fitTextFontSize(doc, stopNameUpper, usableWidth, 44, 20);
    doc.font("Helvetica-Bold").fontSize(stopFontSize).fillColor("#111111").text(stopNameUpper, M, doc.y, { width: usableWidth });
    doc.moveDown(0.3);

    // CRATE number — significantly larger, genuinely hard to miss
    doc.font("Helvetica-Bold").fontSize(36).fillColor("#111111").text(`CRATE ${crateNumber}`, M, doc.y, { width: usableWidth });
    const orderLineY = doc.y;
    doc.font("Helvetica").fontSize(10).fillColor("#666666").text(`Order: ${order.orderName}`, M, orderLineY, { width: usableWidth });

    // Small, subtle "Picked by [name]" — right-aligned on the same line
    // as the order number, right above the divider. No badge, no photo,
    // just quiet text.
    if (record.pickedBy) {
      doc.font("Helvetica").fontSize(9).fillColor("#999999")
        .text("Picked by " + firstNameOf(record.pickedBy), M, orderLineY, { width: usableWidth, align: "right" });
    }

    doc.moveDown(0.8);
    doc.moveTo(M, doc.y).lineTo(288 - M, doc.y).strokeColor("#222222").lineWidth(1).stroke();
    doc.moveDown(0.6);

    doc.font("Helvetica-Bold").fontSize(9).fillColor("#8A8580").text("CONTENTS", { align: "left" });
    doc.moveDown(0.4);

    const qtyColX = M;
    const titleColX = M + 26;
    const titleColWidth = 288 - M - titleColX;

    // A label is one physical sticker — it can never legitimately spill
    // onto a second PDF page (pdfkit will silently start one on
    // overflow, and the QR/branding footer would print on a page
    // nobody ever sticks on the crate — caught this in testing with an
    // 8-item crate before it ever reached a real printer). Try row
    // sizes from most-readable down to tightest, and use the first tier
    // that actually fits every item — not just whichever tier the
    // *average* per-row space happens to land in, which under-fit
    // crates that would have fit cleanly one size down.
    const FOOTER_RESERVE = 92; // rule + QR + caption + brand block, worst case
    const availableForItems = (432 - 6) - doc.y - FOOTER_RESERVE;
    const ROW_TIERS = [
      { itemFontSize: 11, rowHeight: 19, rowGap: 5 },
      { itemFontSize: 9.5, rowHeight: 15, rowGap: 3 },
      { itemFontSize: 8.5, rowHeight: 12, rowGap: 2 },
      { itemFontSize: 7.5, rowHeight: 10, rowGap: 1 },
    ];
    let tier = ROW_TIERS[ROW_TIERS.length - 1];
    for (const candidate of ROW_TIERS) {
      if (crateItems.length * (candidate.rowHeight + candidate.rowGap) <= availableForItems) {
        tier = candidate;
        break;
      }
    }
    const { itemFontSize, rowHeight, rowGap } = tier;

    // Last-resort safety net for a genuinely extreme item count: even
    // the tightest legible row size won't fit everything, so truncate
    // and say so rather than silently spilling onto a second label.
    let displayItems = crateItems;
    let truncatedCount = 0;
    const maxRowsThatFit = Math.max(1, Math.floor(availableForItems / (rowHeight + rowGap)));
    if (crateItems.length > maxRowsThatFit) {
      truncatedCount = crateItems.length - (maxRowsThatFit - 1);
      displayItems = crateItems.slice(0, maxRowsThatFit - 1);
    }

    displayItems.forEach((item, idx) => {
      const rowY = doc.y;
      doc.font("Helvetica-Bold").fontSize(itemFontSize).fillColor("#111111");
      doc.text(String(item.quantity), qtyColX, rowY, { width: 22 });
      doc.text(item.title, titleColX, rowY, { width: titleColWidth });
      const afterY = doc.y;
      doc.y = Math.max(afterY, rowY + rowHeight) + rowGap;
      // A hairline between rows — the kind of quiet structure that
      // reads as "designed," not just a list of text dumped on a page.
      // Skip after the very last item; the footer rule below closes it.
      if (idx < displayItems.length - 1 || truncatedCount > 0) {
        doc.moveTo(M, doc.y - rowGap / 2).lineTo(288 - M, doc.y - rowGap / 2).strokeColor("#E5E3DF").lineWidth(0.5).stroke();
      }
    });
    if (truncatedCount > 0) {
      doc.font("Helvetica-BoldOblique").fontSize(Math.max(itemFontSize - 1, 7)).fillColor("#8A8580")
        .text(`+ ${truncatedCount} more item${truncatedCount === 1 ? "" : "s"} — see packing slip`, M, doc.y, { width: usableWidth });
      doc.moveDown(0.2);
    }

    // Footer — floats right after the contents list instead of being
    // pinned to the bottom of the label. That's the direct fix for
    // "bland, empty looking": a 2-item crate no longer leaves 200pt of
    // dead white space below it, the label just ends where the content
    // does. QR code goes straight to this store's receiving check, so
    // whoever receives the delivery doesn't need it already bookmarked.
    doc.moveDown(0.7);
    const footerRuleY = doc.y;
    doc.moveTo(M, footerRuleY).lineTo(288 - M, footerRuleY).strokeColor("#111111").lineWidth(1).stroke();

    const footerTop = footerRuleY + 10;
    const qrSize = 56;
    try {
      const qrUrl = `${RECEIVING_APP_URL}/receiving/${encodeURIComponent(decodeURIComponent(req.params.stopName))}`;
      const qrBuffer = await QRCode.toBuffer(qrUrl, { width: 220, margin: 1 });
      doc.image(qrBuffer, M, footerTop, { width: qrSize, height: qrSize });
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#8A8580")
        .text("SCAN TO CONFIRM RECEIPT", M - 4, footerTop + qrSize + 3, { width: qrSize + 8, align: "center" });
    } catch (e) {
      /* A QR failure is never worth blocking the label from printing */
    }

    const footerTextX = M + qrSize + 14;
    const footerTextWidth = 288 - M - footerTextX;
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#111111")
      .text("Hummus Fit", footerTextX, footerTop + 4, { width: footerTextWidth });
    doc.font("Helvetica").fontSize(8).fillColor("#8A8580")
      .text("Eat Better. Live Better.", footerTextX, doc.y, { width: footerTextWidth });
    doc.font("Helvetica").fontSize(7.5).fillColor("#8A8580")
      .text("myhummusfit.com", footerTextX, doc.y + 3, { width: footerTextWidth });

    doc.end();
  } catch (err) {
    res.status(500).send("Error generating crate label: " + err.message);
  }
});

app.get("/api/missing-items-pdf/:stopName", async (req, res) => {
  try {
    const cache = await fetchTodaysStopOrders();
    const key = pickingKeyFor(decodeURIComponent(req.params.stopName));
    const order = cache.byStopName[key];
    if (!order) return res.status(404).send("No order found for this stop.");

    const state = loadState();
    const record = getPickingRecord(state, key, order);

    const missingItems = order.lineItems
      .map((item, idx) => {
        const status = record.itemStatus[idx];
        if (status === "missing") {
          return { ...item, idx, note: record.itemNotes[idx] || "", quantity: item.quantity };
        }
        if (status === "partial") {
          const pickedQty = record.itemPickedQty[idx] || 0;
          const shortQty = item.quantity - pickedQty;
          return {
            ...item,
            idx,
            note: record.itemNotes[idx] || "",
            quantity: shortQty,
            isPartial: true,
            originalQty: item.quantity,
            pickedQty,
          };
        }
        return null;
      })
      .filter((item) => item !== null);

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
      const headerY = doc.y;
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#8A8580");
      doc.text("QTY", 50, headerY, { width: 40, lineBreak: false });
      doc.text("ITEM", 95, headerY, { width: 280, lineBreak: false });
      doc.text("REASON", 380, headerY, { lineBreak: false });
      doc.y = headerY + 16;
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#222222").lineWidth(1).stroke();
      doc.y += 10;
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
      const displayTitle = item.isPartial
        ? `${item.title} — SHORT (picked ${item.pickedQty} of ${item.originalQty})`
        : item.title;
      const textHeight = doc.heightOfString(displayTitle, { width: 280, fontSize: 11 });
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
      doc.text(displayTitle, 95, rowY + 1, { width: 280 });
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
    const simplified = vehicles.map((v) => {
      // A couple of vans (the 2016 Ford Transit, the 2022 RAM Promaster)
      // never got a nickName set in Bouncie. v.model is an object
      // ({make, name, year}), not a string — falling straight through to
      // it, as this used to, handed the dispatch board's frontend an
      // object where it expects a string and it crashed calling
      // .toLowerCase() on it, which took the whole route board down.
      let nickName = v.nickName;
      if (!nickName && v.model) {
        nickName = [v.model.year, v.model.make, v.model.name].filter(Boolean).join(" ");
      }
      return {
        nickName: nickName || "",
        speed: (v.stats && v.stats.speed) || 0,
        isRunning: !!(v.stats && v.stats.isRunning),
        address: (v.stats && v.stats.location && v.stats.location.address) || "",
      };
    });
    vanStatusCache = { fetchedAt: now, vehicles: simplified };
    res.json({ vehicles: simplified, configured: true });
  } catch (err) {
    res.json({ vehicles: [], configured: false, error: err.message });
  }
});

// ================= GOOGLE MAPS — ROUTE OPTIMIZATION & LIVE ETA =================
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

function getRouteById(routeId) {
  return ROUTES.find((r) => r.id === routeId) || B2B_ROUTES.find((r) => r.id === routeId);
}

// Same lookup a store employee's QR-code page needs: given the stop name
// on their picklist, find which route/van they're on and their real
// position in it (used below to compute a live ETA once that route has
// actually been started for the day).
function findRouteAndStopByName(stopName) {
  const target = String(stopName || "").trim().toLowerCase();
  for (const route of [...ROUTES, ...B2B_ROUTES]) {
    const stop = route.stops.find((s) => s.name.toLowerCase() === target);
    if (stop) return { route, stop };
  }
  return null;
}

// Live ETA for one store's delivery, shown on their picklist page (the
// same page the QR code lands them on). Mirrors the math in
// /api/route-eta/:routeId, just resolved down to a single stop by name
// instead of the whole route. Returns null if this stop name doesn't
// match a real route stop at all; returns started:false (with just the
// scheduled time slot) if the route hasn't been started yet today, since
// there's nothing live to show until a driver actually leaves HQ.
function computeEtaForStop(state, stopName) {
  const found = findRouteAndStopByName(stopName);
  if (!found) return null;
  const { route, stop } = found;

  // Ground truth beats the math: if the driver has already marked this
  // stop delivered on the dispatch board, say so directly instead of
  // falling through to an eta calc that would otherwise go blank/pending
  // once the stop is behind the van in the optimized order (see the loop
  // below — a passed stop simply stops matching, which used to render as
  // nothing at all on the store-facing page).
  // Whichever van is currently assigned to this route — already persisted
  // by /api/assign and correctly scoped to the active delivery window (see
  // loadState's reset logic above), so this is real ground truth, not a
  // guess. Store employees use this to open the live van map for the exact
  // van heading to them, not just a generic fleet view.
  const van = (state.assignments[route.id] && state.assignments[route.id].van) || null;
  const vanImei = van ? VAN_TO_BOUNCIE_IMEI[van] || null : null;

  const stopStatus = state.stopStatus[stop.id];
  if (stopStatus && stopStatus.status === "delivered") {
    return {
      routeId: route.id,
      routeName: route.name,
      scheduledTime: route.time || null,
      started: true,
      delivered: true,
      deliveredAt: stopStatus.deliveredAt || null,
      eta: null,
      stopsAway: null,
      van,
      vanImei,
      fleetTrackerUrl: FLEET_TRACKER_URL,
    };
  }

  const meta = state.routeMeta[route.id];
  if (!meta || !meta.startedAt || !meta.legDurationsSeconds || !meta.optimizedStopIds) {
    return {
      routeId: route.id,
      routeName: route.name,
      scheduledTime: route.time || null,
      started: false,
      delivered: false,
      eta: null,
      stopsAway: null,
      van,
      vanImei,
      fleetTrackerUrl: FLEET_TRACKER_URL,
    };
  }
  const startedAt = new Date(meta.startedAt).getTime();
  const UNLOAD_MS = UNLOAD_MINUTES_PER_STOP * 60 * 1000;
  let cumulativeMs = 0;
  for (let i = 0; i < meta.optimizedStopIds.length; i++) {
    // Same math as /api/route-eta/:routeId — drive time for this leg,
    // plus every prior stop already used up its own unload buffer before
    // the van could pull away again. Leaving the unload buffer out here
    // would show every stop after the first as arriving earlier than the
    // van actually can.
    cumulativeMs += (meta.legDurationsSeconds[i] || 0) * 1000;
    if (meta.optimizedStopIds[i] === stop.id) {
      return {
        routeId: route.id,
        routeName: route.name,
        scheduledTime: route.time || null,
        started: true,
        delivered: false,
        eta: new Date(startedAt + cumulativeMs).toISOString(),
        stopsAway: i,
        totalStopsOnRoute: meta.optimizedStopIds.length,
        van,
        vanImei,
        fleetTrackerUrl: FLEET_TRACKER_URL,
      };
    }
    cumulativeMs += UNLOAD_MS;
  }
  // Route was started, but this stop isn't in the optimized order (e.g.
  // it was added after "Create Route" already ran today) — no ETA yet.
  return {
    routeId: route.id,
    routeName: route.name,
    scheduledTime: route.time || null,
    started: true,
    delivered: false,
    eta: null,
    stopsAway: null,
    van,
    vanImei,
    fleetTrackerUrl: FLEET_TRACKER_URL,
  };
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

// Public, cross-service ETA lookup by store name — this is what the
// hummusfit-receiving app's employee-facing page calls (via a browser
// fetch from a different Railway domain, hence the CORS header) to show
// "your delivery arrives at X" alongside the receiving checklist. Kept
// deliberately separate from the warehouse-only /api/picking-* routes,
// which have nothing to do with the store side of this.
app.get("/api/store-eta/:stopName", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  const state = loadState();
  const eta = computeEtaForStop(state, decodeURIComponent(req.params.stopName));
  if (!eta) {
    return res.status(404).json({ error: "No route stop matches that store name." });
  }
  res.json(eta);
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
app.get("/out-of-state", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "out-of-state.html"));
});
app.get("/sku-coverage", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "sku-coverage.html"));
});

app.use(express.static(path.join(__dirname, "public")));

// Runs independently of anyone having the app open — checks for orders
// on stops that didn't have one moments ago, and pushes a notification
// the instant one shows up, so pickers actually get notified in real
// time rather than only finding out next time they check the app.
let previousOrderStopKeys = new Set();
async function checkForNewOrdersAndNotify() {
  try {
    const cache = await fetchTodaysStopOrders();
    const currentKeys = new Set(Object.keys(cache.byStopName));
    const newlyAppeared = [...currentKeys].filter((k) => !previousOrderStopKeys.has(k));

    // Skip the very first run after a fresh server start — everything
    // would look "new" then, which would fire a flood of notifications
    // for orders that have actually been sitting there for a while.
    if (previousOrderStopKeys.size > 0) {
      for (const key of newlyAppeared) {
        const order = cache.byStopName[key];
        const stopName = STOP_DISPLAY_NAME.get(key) || key;
        await sendPushToAll({
          title: (order.isB2B ? "🟢 Out of State — " : "🟠 Store Route — ") + stopName,
          body: order.isB2B
            ? "Out-of-state order just came in for " + stopName
            : "Ready to pick — order just came in for " + stopName,
          url: "/picking?stop=" + encodeURIComponent(stopName),
          icon: order.isB2B ? "/icon-192-oos.png" : "/icon-192.png",
        });
      }
    }
    previousOrderStopKeys = currentKeys;
  } catch (err) {
    console.error("checkForNewOrdersAndNotify failed:", err.message);
  }
}
setInterval(checkForNewOrdersAndNotify, 60 * 1000);
checkForNewOrdersAndNotify();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Route board running on port ${PORT}`);
});
