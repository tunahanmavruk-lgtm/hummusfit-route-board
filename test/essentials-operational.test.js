const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const {
  lineItemsForWorkflow,
  normalizePickingWorkflow,
  workflowCompletion,
} = require('../picking-workflow');

test('guards operational Essentials separation behind its own feature flag', () => {
  const server = read('server.js');
  assert.match(server, /process\.env\.ESSENTIALS_SEPARATION_ENABLED === "true"/);
  assert.match(server, /lineItemsForWorkflow\(order, workflow, ESSENTIALS_SEPARATION_ENABLED\)/);
  assert.match(server, /state\.essentialsPicking/);
  assert.match(server, /waitingForWorkflow: completion\.waitingForWorkflow/);
});

test('holds Shopify fulfillment until food and Essentials are both complete', () => {
  const server = read('server.js');
  const start = server.indexOf('app.post("/api/picking-finish"');
  const end = server.indexOf('app.post("/api/picking-reopen"', start);
  const handler = server.slice(start, end);
  assert.match(handler, /workflowCompletion\(/);
  assert.match(handler, /if \(allWorkflowsComplete\) \{[\s\S]*autoFulfillPickedOrders\(sourceOrder\)/);
  assert.match(handler, /Essentials item\(s\) still have unverified cases or unresolved shortages/);
  assert.match(handler, /essentialsLineResolved\(item\.status, item\.pickedQty, item\.verifiedCases, item\.requiredCases\)/);
});

test('functionally splits one Shopify order without losing or duplicating lines', () => {
  const order = {
    lineItems: [
      { title: 'Chicken Bowl', sku: 'FOOD', quantity: 4 },
      { title: 'Protein Cold Brew', sku: 'RETAIL', quantity: 2, productTags: ['Retail Essentials'] },
      { title: 'Paper Cups', sku: 'OTHER', quantity: 1, productTags: ['Other Essentials'] },
    ],
  };
  assert.equal(normalizePickingWorkflow('essentials', false), 'orders');
  assert.equal(normalizePickingWorkflow('essentials', true), 'essentials');
  const food = lineItemsForWorkflow(order, 'orders', true);
  const essentials = lineItemsForWorkflow(order, 'essentials', true);
  assert.deepEqual(food.map(item => item.sku), ['FOOD']);
  assert.deepEqual(essentials.map(item => item.sku), ['RETAIL', 'OTHER']);
  assert.equal(food.length + essentials.length, order.lineItems.length);
  assert.equal(new Set(food.concat(essentials)).size, order.lineItems.length);
});

test('functionally blocks fulfillment until both workstreams finish', () => {
  const order = {
    lineItems: [
      { title: 'Chicken Bowl', sku: 'FOOD' },
      { title: 'Paper Cups', sku: 'OTHER', productTags: ['Other Essentials'] },
    ],
  };
  assert.deepEqual(workflowCompletion(order, { completedAt: 'now' }, {}, true), {
    foodComplete: true,
    essentialsComplete: false,
    allComplete: false,
    waitingForWorkflow: 'essentials',
  });
  assert.deepEqual(workflowCompletion(order, { completedAt: 'now' }, { completedAt: 'later' }, true), {
    foodComplete: true,
    essentialsComplete: true,
    allComplete: true,
    waitingForWorkflow: null,
  });
});

test('routes one NETUM to distinct order and Essentials printer profiles', () => {
  const bridge = read('android-print-bridge/src/com/hummusfit/autoprint/MainActivity.java');
  const picking = read('public/picking.html');
  const server = read('server.js');
  assert.match(bridge, /DEFAULT_ORDER_IP = "10\.0\.75\.254"/);
  assert.match(bridge, /DEFAULT_ESSENTIALS_IP = "192\.168\.6\.41"/);
  assert.match(bridge, /"orders"\.equals\(printerName\)/);
  assert.match(bridge, /"essentials"\.equals\(printerName\)/);
  assert.match(bridge, /Unknown printer profile/);
  assert.match(picking, /printer:pickingWorkflow === 'essentials' \? 'essentials' : 'orders'/);
  assert.match(picking, /workflowBody\(/);
  assert.match(picking, /printEssentialsCaseLabel\(result\.itemIndex, result\.scannedCount, result\.totalQty, result\.caseLabelJobId\)/);
  assert.match(picking, /pickingWorkflow === 'essentials' \|\| view !== 'order'/);
  assert.match(server, /Essentials are labeled as individual cases and do not use crates/);
  assert.match(server, /caseLabelJobId: workflow === "essentials"/);
  assert.match(server, /"\/api\/picking-case"/);
  const caseStart = server.indexOf('app.post("/api/picking-case"');
  const caseEnd = server.indexOf('app.post("/api/picking-scan"', caseStart);
  const caseHandler = server.slice(caseStart, caseEnd);
  assert.match(caseHandler, /const caseNumber = priorCount \+ 1/);
  assert.match(caseHandler, /Manual case taps are only available in Essentials Picking/);
  assert.doesNotMatch(caseHandler, /record\.itemScannedCount\[itemKey\] = item\.quantity/);
  assert.match(picking, /\+ Label One Case/);
  assert.match(picking, /playScanFeedback\(\);[\s\S]*printEssentialsCaseLabel/);
});

test('opens scoped Essentials picking from the Essentials board', () => {
  const app = read('essentials-preview/app.js');
  assert.match(app, /\/picking\?workflow=essentials&stop=/);
  assert.match(app, /result\.mode === 'operational'/);
  assert.match(app, /Shopify fulfillment waits until both Food Picking and Essentials Picking are complete/);
});

test('keeps unused scanner work off the Essentials workflow', () => {
  const picking = read('public/picking.html');
  assert.doesNotMatch(picking, /<script src="https:\/\/unpkg\.com\/html5-qrcode/);
  assert.match(picking, /if\(pickingWorkflow !== 'essentials'\) pollNativeScanner\(\)/);
  assert.match(picking, /pickingWorkflow !== 'essentials' && view === 'order'/);
  assert.match(picking, /loadCameraScannerLibrary\(\)/);
});
