const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('keeps the Essentials preview disabled unless explicitly enabled', () => {
  const server = read('server.js');
  assert.match(server, /process\.env\.ESSENTIALS_ROUTE_BOARD_ENABLED === "true"/);
  assert.match(server, /if \(!ESSENTIALS_ROUTE_BOARD_ENABLED\) return res\.sendStatus\(404\)/);
  assert.match(server, /ESSENTIALS_PREVIEW_DIR = path\.join\(__dirname, "essentials-preview"\)/);
  assert.doesNotMatch(read('public/index.html'), /href="\/essentials"/);
  assert.doesNotMatch(read('public/out-of-state.html'), /href="\/essentials"/);
  assert.doesNotMatch(read('public/picking.html'), /href="\/essentials"/);
});

test('keeps the preview outside the food order, scan, route, and print contracts', () => {
  const html = read('essentials-preview/index.html');
  const script = read('essentials-preview/app.js');
  const combined = html + script;
  for (const forbidden of [
    '/api/today-orders', '/api/picking-', '/api/assign', '/api/stop-status',
    '/api/start-route', '/api/crate-label', '127.0.0.1:8877', 'window.print(',
  ]) assert.ok(!combined.includes(forbidden), `preview must not call ${forbidden}`);
  assert.doesNotMatch(script, /fetch\s*\(/);
  assert.match(html, /Preview · offline data/);
});

test('shows the approved simple Essentials-only warehouse workflow', () => {
  const html = read('essentials-preview/index.html');
  for (const text of [
    'Essentials only — food orders never appear here.',
    'Retail Essentials', 'Other Essentials', 'New Orders', 'Picking',
    'Labeled', 'Ready to Route', '3×1 Zebra label preview',
  ]) assert.ok(html.includes(text), `missing ${text}`);
  assert.match(html, /--green:#3d8a83|styles\.css/);
  const css = read('essentials-preview/styles.css');
  assert.match(css, /--green:#3d8a83/);
  assert.match(css, /--orange:#df6437/);
  assert.doesNotMatch(css, /purple|#6f42c1|#7c3aed|#8b5cf6/i);
});
