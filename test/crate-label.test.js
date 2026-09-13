const assert = require("node:assert/strict");
const test = require("node:test");
const { PassThrough } = require("node:stream");

const {
  LABEL_HEIGHT_PT,
  LABEL_WIDTH_PT,
  renderCrateLabelPdf,
} = require("../crate-label.js");

function render(items) {
  return new Promise((resolve, reject) => {
    const output = new PassThrough();
    const chunks = [];
    output.on("data", (chunk) => chunks.push(chunk));
    output.on("end", () => resolve(Buffer.concat(chunks)));
    output.on("error", reject);
    renderCrateLabelPdf(output, {
      routeName: "Route #3",
      stopNameUpper: "HUNTINGTON",
      orderName: "#TEST-1001",
      pickedBy: "Warehouse Picker",
      crateItems: items,
    }, 2);
  });
}

test("renders a single landscape 4x3-inch Zebra label", async () => {
  assert.equal(LABEL_WIDTH_PT, 288);
  assert.equal(LABEL_HEIGHT_PT, 216);
  const pdf = await render([
    { quantity: 8, title: "Chicken Bowl" },
    { quantity: 4, title: "Steak Bowl" },
  ]);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.match(pdf.toString("latin1"), /\/MediaBox \[0 0 288 216\]/);
  assert.equal((pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length, 1);
});

test("keeps a crowded crate on one physical label", async () => {
  const items = Array.from({ length: 30 }, (_, index) => ({
    quantity: index + 1,
    title: `Long prepared meal name ${index + 1}`,
  }));
  const pdf = await render(items);
  assert.equal((pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length, 1);
});
