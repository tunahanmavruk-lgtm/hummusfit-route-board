const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const board = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

test("keeps the current Long Island routes grouped in delivery order", () => {
  assert.match(server, /name: "Route #1"[\s\S]*?Deer Park[\s\S]*?Lindenhurst[\s\S]*?Islip/);
  assert.match(server, /name: "Route #2"[\s\S]*?Lynbrook[\s\S]*?Island Park[\s\S]*?Bellmore[\s\S]*?Ozone Park/);
  assert.match(server, /name: "Route #3"[\s\S]*?time: "8:00 AM"[\s\S]*?Woodbury[\s\S]*?Huntington[\s\S]*?Farmingdale[\s\S]*?Hicksville/);
});

test("keeps Route #4's Lake Grove visit as a van-swap checkpoint only", () => {
  assert.match(server, /responsibleDriver: "Berke or Hazar"/);
  assert.match(server, /name: "Lake Grove — Van Swap"[^\n]*isServiceStop: true/);
  assert.match(server, /route\.stops\.filter\(\(s\) => !s\.isServiceStop\)/);
  assert.match(board, /stop-instruction/);
  assert.match(board, /stop\.instruction/);
});

test("assigns Route #5 to Richie and separates Lake Grove delivery and pickup duties", () => {
  assert.match(server, /name: "Route #5"[\s\S]*?responsibleDriver: "Richie"[\s\S]*?defaultDriver: "Chavez, Richy C"/);
  assert.match(server, /name: "Ronkonkoma"[^\n]*instruction: "Product drop-off\."/);
  assert.match(server, /name: "Lake Grove"[^\n]*Drop off Lake Grove's order and empty crates\. Pick up chicken, ingredients, and bus containers for Holbrook\./);
  assert.match(server, /name: "Holbrook"[^\n]*Drop off the chicken, ingredients, and bus containers picked up at Lake Grove\./);
  assert.match(board, /Permanent responsibility/);
});

test("invalidates cached navigation when a permanent route changes", () => {
  assert.match(server, /function cachedRouteMatchesDefinition/);
  assert.match(server, /!cachedRouteMatchesDefinition\(state\.routeMeta\[routeId\], route\)/);
  assert.match(board, /meta\.optimizedStopIds\.every/);
});

test("uses the warehouse picker roster requested for order picking", () => {
  const pickerBlock = server.match(/const PICKERS = \[([\s\S]*?)\];/)[1];
  assert.match(pickerBlock, /"Hakan"/);
  assert.match(pickerBlock, /"Ufuk"/);
  assert.doesNotMatch(pickerBlock, /Tanglay, Serol/);
  assert.doesNotMatch(pickerBlock, /Ali Dumez/);
});

test("shows Monday out-of-state work from Friday through delivery day", () => {
  assert.match(server, /todayDow === 5 \|\| todayDow === 6/);
  assert.match(server, /day: 1, dayLabel: "Preparing for Monday"/);
  assert.match(server, /routes: visibleRoutes/);
  assert.match(server, /dayLabel: "Tomorrow — " \+ dayNames\[tomorrowDow\]/);
});
