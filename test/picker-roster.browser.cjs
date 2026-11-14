// Isolated browser test. External requests and service workers are blocked.
const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function checkRoster(browserType, workflow) {
  const browser = await browserType.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.clock.install();
    let roster = ['Hakan', 'Gabriel', 'Ufuk'];
    let unavailable = false;
    let rosterReads = 0;
    let detailReads = 0;
    let navigations = 0;
    const posts = [];
    const errors = [];
    const detail = {
      stopName: 'huntington',
      orderName: '#LOCAL',
      orderId: 'gid://shopify/Order/1',
      workflow,
      pickedBy: 'Ufuk',
      pickers: [...roster],
      lineItems: [{ title: 'Local item', sku: 'LOCAL', quantity: 10 }],
      itemStatus: { 0: 'partial' },
      itemPickedQty: { 0: 4 },
      itemScannedCount: { 0: 4 },
      itemNotes: { 0: 'Keep this saved note' },
      currentCrateNumber: 2,
      closedCrates: [1],
      itemCrateNumber: { 0: 2 },
      itemCrateBreakdown: { 0: { 2: 4 } },
    };
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.hostname !== 'roster.test') return route.abort();
      if (!['GET', 'HEAD'].includes(request.method())) {
        posts.push(url.pathname);
        return route.fulfill({ json: { ok: true } });
      }
      if (url.pathname === '/picking') {
        navigations++;
        return route.fulfill({
          contentType: 'text/html',
          body: fs.readFileSync(path.join(__dirname, '../public/picking.html'), 'utf8'),
        });
      }
      if (url.pathname === '/api/picking-roster') {
        rosterReads++;
        return route.fulfill({ status: unavailable ? 503 : 200, json: { pickers: roster } });
      }
      if (url.pathname.startsWith('/api/picking-order/')) {
        detailReads++;
        return route.fulfill({ json: detail });
      }
      const file = path.join(__dirname, '../public', url.pathname);
      if (url.pathname.endsWith('.js') && fs.existsSync(file)) {
        return route.fulfill({
          contentType: 'application/javascript',
          body: fs.readFileSync(file, 'utf8'),
        });
      }
      return route.fulfill({ json: { available: false } });
    });
    await page.goto('http://roster.test/picking?stop=huntington&workflow=' + workflow);
    const picker = page.locator('#pickerSelect');
    await picker.waitFor();
    await page.waitForFunction(() => document.querySelector('#pickerSelect option[value="Hakan"]'));

    const originalPickerNode = await picker.elementHandle();
    const originalMainText = await page.locator('#mainContent').textContent();
    const scanInput = page.locator('#hwScanInput');
    await scanInput.fill('barcode-in-progress');
    roster = ['Alper', 'Ufuk'];
    await page.clock.fastForward(15001);
    await page.waitForFunction(() => document.querySelector('#pickerSelect option[value="Alper"]'));
    assert.equal(await picker.inputValue(), 'Ufuk');
    assert.equal(await picker.locator('option[value="Hakan"],option[value="Gabriel"]').count(), 0);
    assert.equal(await scanInput.inputValue(), 'barcode-in-progress');
    assert.equal(await scanInput.evaluate(element => element === document.activeElement), true);
    assert.equal(await originalPickerNode.evaluate(element => element === document.getElementById('pickerSelect')), true);
    assert.equal((await page.locator('#mainContent').textContent()).replace('Alper', ''), originalMainText.replace('HakanGabriel', ''));
    assert.equal(detailReads, 1);
    assert.equal(navigations, 1);
    assert.deepEqual(posts, []);

    await picker.focus();
    roster = ['Alper', 'Ufuk', 'New picker'];
    await page.clock.fastForward(15001);
    assert.equal(await picker.locator('option[value="New picker"]').count(), 0, 'open selection stays stable');
    await scanInput.focus();
    await page.waitForFunction(() => document.querySelector('#pickerSelect option[value="New picker"]'));

    unavailable = true;
    const beforeFailure = await picker.innerHTML();
    await page.clock.fastForward(15001);
    assert.equal(await picker.innerHTML(), beforeFailure);
    unavailable = false;
    roster = ['Alper', 'Ufuk', 'Returned picker'];
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => document.querySelector('#pickerSelect option[value="Returned picker"]'));
    assert.equal(await picker.inputValue(), 'Ufuk');
    assert.equal(navigations, 1);
    assert.equal(detailReads, 1);
    assert(rosterReads >= 4);
    assert.deepEqual(posts, []);
    assert.deepEqual(errors, []);
    console.log(browserType.name() + ' ' + workflow + ': roster updates preserve counts, selection, scanner focus and requests');
  } finally {
    await browser.close();
  }
}

(async () => {
  for (const browser of [chromium, webkit]) {
    for (const workflow of ['orders', 'essentials']) {
      await checkRoster(browser, workflow);
    }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
