const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const pages = [
  ['public/index.html', 'page-local-route', 'Long Island routes'],
  ['public/out-of-state.html', 'page-out-of-state', 'Out-of-state'],
  ['public/picking.html', 'page-picking', 'Order picking'],
];

test('uses one HF Logistics shell across driver and picker interfaces', () => {
  for (const [file, pageClass, activeLabel] of pages) {
    const html = read(file);
    assert.match(html, /\/hf-logistics-theme\.css\?v=1/);
    assert.match(html, new RegExp(`<body class="${pageClass}`));
    assert.match(html, /class="hf-appbar"/);
    assert.match(html, /https:\/\/logistics\.myhummusfit\.com\//);
    assert.match(html, new RegExp(`class="active"[^>]*>${activeLabel}<`));
  }
});

test('retains the operational route-board hooks after the visual refactor', () => {
  for (const file of ['public/index.html', 'public/out-of-state.html']) {
    const html = read(file);
    for (const hook of ['data-optimize', 'data-start', 'van-select', 'driver-select', 'data-stop']) {
      assert.ok(html.includes(hook), `${file} must retain ${hook}`);
    }
  }
});

test('retains scanner, crate, picking, and finish controls', () => {
  const html = read('public/picking.html');
  for (const hook of ['hwScanInput', 'scannerOverlay', 'crateFab', 'pickerSelect', 'finishBtn', 'btPrinterStatus']) {
    assert.ok(html.includes(hook), `picking page must retain ${hook}`);
  }
});

test('never renders undefined route metadata on the out-of-state board', () => {
  const html = read('public/out-of-state.html');
  assert.match(html, /route\.time \|\| '4:00 AM'/);
  assert.match(html, /route\.vanSize \|\|/);
});

test('requires a signed HF Logistics session for operational changes', () => {
  const server = read('server.js');
  assert.match(server, /HF_LOGISTICS_HANDOFF_SECRET/);
  assert.match(server, /app\.get\("\/auth\/hf-logistics"/);
  assert.match(server, /verifyLogisticsToken\(token, "board\.write"\)/);
  assert.match(server, /httpOnly: true/);
  assert.match(server, /req\.method === "POST"[\s\S]*requireBoardWrite/);
});

test('keeps active warehouse picking available on dedicated scanners', () => {
  const server = read('server.js');
  assert.match(server, /PUBLIC_OPERATIONAL_POST_PATHS/);
  for (const path of [
    '/api/picking-item',
    '/api/picking-scan',
    '/api/picking-new-crate',
    '/api/picking-reopen-crate',
    '/api/picking-set-picker',
    '/api/picking-finish',
    '/api/picking-reopen',
  ]) {
    assert.ok(server.includes(`"${path}"`), `${path} must remain available to warehouse scanners`);
  }
  const allowlist = server.slice(
    server.indexOf('const PUBLIC_OPERATIONAL_POST_PATHS'),
    server.indexOf('app.use((req, res, next)', server.indexOf('const PUBLIC_OPERATIONAL_POST_PATHS')),
  );
  assert.doesNotMatch(allowlist, /"\/api\/picking-reset-order"/);
});

test('does not embed the VAPID private key in source', () => {
  const server = read('server.js');
  assert.match(server, /process\.env\.VAPID_PRIVATE_KEY/);
  assert.doesNotMatch(server, /VAPID_PRIVATE_KEY\s*=\s*"B[A-Za-z0-9_-]{40,}"/);
});
