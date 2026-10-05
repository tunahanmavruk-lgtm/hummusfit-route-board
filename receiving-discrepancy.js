const crypto = require("crypto");

// A warehouse conversion posts the fully picked case count before delivery.
// A short store receipt therefore reverses sell units, not case inventory.
function shortageKey(store, orderId, caseSku) {
  return crypto.createHash("sha256").update(JSON.stringify([
    "agent-hazar-receiving", store, orderId, caseSku,
  ])).digest("hex");
}

function retailShortagePlan({ store, orderId, reportId, line, postedConversion, unitItem, locationId }) {
  if (!line || !Number.isSafeInteger(line.pickedCases) || !Number.isSafeInteger(line.receivedCases) ||
      !Number.isSafeInteger(line.unitsPerCase) || line.unitsPerCase < 1 ||
      line.receivedCases < 0 || line.receivedCases >= line.pickedCases ||
      !line.unitSku || !line.caseSku) throw new Error("A verified retail case shortage is required");
  const expectedUnits = line.pickedCases * line.unitsPerCase;
  if (postedConversion?.status !== "posted" || postedConversion.units !== expectedUnits ||
      !postedConversion.adjustmentId) throw new Error("The original POS case conversion is not confirmed");
  const delta = (line.receivedCases - line.pickedCases) * line.unitsPerCase;
  if (!Number.isSafeInteger(delta) || delta >= 0 || delta < -100000 ||
      !unitItem?.id || !Number.isSafeInteger(unitItem.available) || unitItem.available < -delta) {
    throw new Error("POS sell-unit stock cannot safely cover this shortage correction");
  }
  const key = shortageKey(store, orderId, line.caseSku);
  return {
    key, store, orderId, reportId, caseSku: line.caseSku, unitSku: line.unitSku,
    pickedCases: line.pickedCases, receivedCases: line.receivedCases,
    delta, inventoryItemId: unitItem.id, locationId,
    input: {
      name: "available", reason: "correction",
      referenceDocumentUri: `gid://agent-hazar-receiving/Report/${key}`,
      changes: [{ inventoryItemId: unitItem.id, locationId, delta,
        changeFromQuantity: unitItem.available }],
    },
  };
}

module.exports = { retailShortagePlan, shortageKey };
