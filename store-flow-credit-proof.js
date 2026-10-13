const { POS_STORE_LOCATIONS } = require("./essentials-pos-conversion");

// A receiving correction may run only after Shopify proves that this exact
// fulfilled food line was credited to the same Hummus Fit POS location.
function verifiedStoreFlowCredit({ store, order, group, lineItemId, locationId,
  warehouseLocationId, cutover, flowAppId }) {
  const expectedLocationName = POS_STORE_LOCATIONS[store];
  if (!expectedLocationName || !Number.isFinite(cutover) ||
      (flowAppId && !/^gid:\/\/shopify\/App\/[0-9]+$/.test(flowAppId)) ||
      !/^gid:\/\/shopify\/LineItem\/[0-9]+$/.test(lineItemId || "") ||
      !/^gid:\/\/shopify\/Location\/[0-9]+$/.test(locationId || "") ||
      !/^gid:\/\/shopify\/Location\/[0-9]+$/.test(warehouseLocationId || "")) {
    throw new Error("Exact Hummus Fit store and Flow proof configuration are required");
  }
  if (!/^gid:\/\/shopify\/Order\/[0-9]+$/.test(order?.id || "") ||
      !Number.isFinite(Date.parse(order.createdAt)) || Date.parse(order.createdAt) < cutover ||
      order.displayFulfillmentStatus !== "FULFILLED" ||
      order.lineItems?.pageInfo?.hasNextPage || !Array.isArray(order.lineItems?.nodes) ||
      !order.lineItems.nodes.length) {
    throw new Error("A complete, post-cutover fulfilled Shopify order is required");
  }
  const tags = [...(order.tags || []), ...(order.customer?.tags || [])]
    .map((tag) => String(tag).trim().toLowerCase());
  const storeTags = [...new Set(tags.map(tag => tag === 'hummus fit east islip' ? 'hummus fit islip' : tag).filter((tag) =>
    tag.startsWith("hummus fit ") && tag !== "hummus fit store"))];
  const expectedTag=expectedLocationName.toLowerCase().replace('hummus fit east islip','hummus fit islip');
  if (storeTags.length !== 1 || storeTags[0] !== expectedTag) {
    throw new Error("Order does not resolve exclusively to the requested Hummus Fit store");
  }
  if (!Array.isArray(order.fulfillments) || !order.fulfillments.length ||
      order.fulfillments.length >= 100 || order.fulfillments.some((fulfillment) =>
        fulfillment.status !== 'SUCCESS' || fulfillment.location?.id !== warehouseLocationId)) {
    throw new Error("All fulfillments must originate at Hummus Fit Shipping Warehouse");
  }
  const lines = order.lineItems.nodes.map((line) => ({
    lineItemId: line.id, sku: String(line.sku || "").trim(), quantity: Number(line.quantity),
    inventoryItemId: line.variant?.inventoryItem?.id,
  }));
  const line = lines.find((entry) => entry.lineItemId === lineItemId);
  if (!line) throw new Error("The credited line is not part of this store order");
  // Shopify can include custom or otherwise SKU-less lines in the same
  // fulfilled order. They cannot be reconciled to a POS SKU, but they must
  // not invalidate proof for the other, mapped food lines in that order.
  if (!line.sku || !/^gid:\/\/shopify\/InventoryItem\/[0-9]+$/.test(line.inventoryItemId || "") ||
      !Number.isSafeInteger(line.quantity) || line.quantity < 1) return null;
  if (!/^gid:\/\/shopify\/InventoryAdjustmentGroup\/[0-9]+$/.test(group?.id || "") ||
      group.referenceDocumentUri !== order.id ||
      !/^gid:\/\/shopify\/App\/[0-9]+$/.test(group.app?.id || "") ||
      (flowAppId && group.app.id !== flowAppId) ||
      !["correction", "inventory correction"].includes(String(group.reason || "").trim().toLowerCase()) ||
      !Number.isFinite(Date.parse(group.createdAt)) || Date.parse(group.createdAt) < cutover ||
      !Array.isArray(group.changes) || !group.changes.length || group.changes.length > 2) {
    throw new Error("Shopify adjustment is not the exact order-linked Flow credit");
  }
  const availableChanges = group.changes.filter((change) => change.name === "available");
  if (availableChanges.length !== 1 || group.changes.some((change) =>
    !["available", "on_hand"].includes(change.name) || change.delta !== line.quantity ||
    change.item?.id !== line.inventoryItemId || change.location?.id !== locationId)) {
    throw new Error("Shopify credit item, quantity, or POS location does not match");
  }
  return { status: "posted", store, orderId: order.id, lineItemId, locationId,
    adjustmentId: group.id, postedAt: group.createdAt, appId: group.app.id,
    lines: [{ sku: line.sku, quantity: line.quantity, inventoryItemId: line.inventoryItemId }] };
}

module.exports = { verifiedStoreFlowCredit };
