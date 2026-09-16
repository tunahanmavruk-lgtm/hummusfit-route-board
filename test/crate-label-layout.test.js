const assert = require("node:assert/strict");
const test = require("node:test");
const buildPages = require("../public/crate-label-layout.js");

test("retains every product and every word across continuation labels", () => {
  const items = Array.from({ length: 45 }, (_, i) => ({
    quantity: i + 1,
    title: i === 7
      ? "BBQ Chicken Garlic Parm Potatoes with Roasted Vegetables and House Sauce"
      : `Prepared Meal Number ${i + 1}`,
  }));
  const pages = buildPages({ crateItems: items });
  assert.ok(pages.length > 1);
  assert.deepEqual(pages.map((page) => page.number), pages.map((_, i) => i + 1));
  assert.ok(pages.every((page) => page.total === pages.length));
  for (let i = 0; i < items.length; i++) {
    const entries = pages.flatMap((page) => page.entries).filter((entry) => entry.sourceIndex === i);
    assert.equal(entries.flatMap((entry) => entry.lines).join(" "), items[i].title);
    assert.equal(entries[0].quantity, String(items[i].quantity));
    assert.ok(entries.every((entry) => entry.y >= 365 && entry.y + entry.height <= 592));
  }
});

test("a product longer than one label continues without losing text", () => {
  const title = Array.from({ length: 90 }, (_, i) => `Ingredient${i}`).join(" ");
  const pages = buildPages({ crateItems: [{ quantity: 2, title }] });
  assert.ok(pages.length > 1);
  assert.equal(pages.flatMap((page) => page.entries.flatMap((entry) => entry.lines)).join(" "), title);
});
