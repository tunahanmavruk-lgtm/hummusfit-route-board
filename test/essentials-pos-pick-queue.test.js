const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const conversion = require("../essentials-pos-conversion");
const { essentialsTypeFor } = require("../essentials-shadow");

test("finished picks queue durably, retry delayed transfers, and share receiving conversion keys", async () => {
  const files = {};
  let calls = 0;
  const context = vm.createContext({ ...conversion, essentialsTypeFor,
    ESSENTIALS_POS_CONVERSION_ENABLED: true, ESSENTIALS_SEPARATION_ENABLED: true,
    ESSENTIALS_POS_CUTOVER: Date.parse("2026-10-04T17:10:25Z"),
    POS_SHOPIFY_CLIENT_ID: "test", POS_SHOPIFY_CLIENT_SECRET: "test",
    POS_PICK_QUEUE_FILE: "queue", posPickQueueRunning: false, process: { pid: 1 },
    console: { log() {}, error() {} }, setInterval: () => ({ unref() {} }),
    fs: { readFileSync: (p) => { if (!(p in files)) throw Object.assign(new Error(), { code: "ENOENT" }); return files[p]; },
      writeFileSync: (p, value) => { files[p] = value; }, renameSync: (a, b) => { files[b] = files[a]; } },
    readItemState: (dict, item, index) => dict[index], loadArchive: () => ({}),
    exactStoreLocation: async (store) => { assert.equal(store, "Holbrook"); return "location"; },
    convertOneReceivedLine: async (store, order, location, line) => {
      calls++;
      assert.equal(order, "order-new"); assert.equal(line.receivedCases, 2);
      if (calls === 1) throw new Error("case transfer not credited yet");
      return { sku: line.caseSku, status: "posted", units: 24 };
    },
  });
  const source = fs.readFileSync(require.resolve("../server.js"), "utf8");
  vm.runInContext(source.slice(source.indexOf("// Warehouse Finish Order now initiates conversion"),
    source.indexOf("// In-memory cache, refreshed on demand")), context);
  const item = { title: "Dreamwich case", sku: "BUILT-PFB0374-CS12", quantity: 2, productCollections: ["Retail Essentials"] };
  const order = { orderId: "order-new", createdAt: "2026-10-05T01:00:00Z", shopifyFulfilled: true,
    lineItems: [item], essentialsRecord: { orderId: "order-new", completedAt: "now", itemStatus: { 0: "picked" }, itemScannedCount: { 0: 2 } } };
  context.enqueuePickedRetailConversion("Holbrook", { ...order, shopifyFulfilled: false });
  context.enqueuePickedRetailConversion("Holbrook", { ...order, createdAt: "2026-10-03T01:00:00Z" });
  assert.equal(files.queue, undefined);
  context.enqueuePickedRetailConversion("Holbrook", order);
  context.enqueuePickedRetailConversion("Holbrook", order);
  assert.equal(Object.keys(JSON.parse(files.queue)).length, 1);
  await context.processPickedRetailConversions();
  assert.equal(JSON.parse(files.queue)["Holbrook::order-new"].status, "pending");
  await context.processPickedRetailConversions();
  assert.equal(JSON.parse(files.queue)["Holbrook::order-new"].status, "complete");
  await context.processPickedRetailConversions();
  assert.equal(calls, 2);
});
