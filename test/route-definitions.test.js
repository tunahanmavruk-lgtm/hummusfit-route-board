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

test("shows the Lake Grove van swap without creating a fake delivery stop", () => {
  assert.match(server, /name: "Lake Grove"[^\n]*instruction: "Swap vans at Lake Grove before returning to Islandia HQ"/);
  assert.match(board, /stop-instruction/);
  assert.match(board, /stop\.instruction/);
});

test("invalidates cached navigation when a permanent route changes", () => {
  assert.match(server, /function cachedRouteMatchesDefinition/);
  assert.match(server, /!cachedRouteMatchesDefinition\(state\.routeMeta\[routeId\], route\)/);
  assert.match(board, /meta\.optimizedStopIds\.every/);
});
