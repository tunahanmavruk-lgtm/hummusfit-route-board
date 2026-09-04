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
