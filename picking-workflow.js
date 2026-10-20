const { essentialsTypeFor } = require('./essentials-shadow');

function normalizePickingWorkflow(value, separationEnabled) {
  return separationEnabled && value === 'essentials' ? 'essentials' : 'orders';
}

function lineItemsForWorkflow(order, workflow, separationEnabled) {
  const items = Array.isArray(order && order.lineItems) ? order.lineItems : [];
  if (!separationEnabled) return items;
  return items.filter((item) => {
    const essential = Boolean(essentialsTypeFor(item));
    return workflow === 'essentials' ? essential : !essential;
  });
}

function workflowCompletion(sourceOrder, foodRecord, essentialsRecord, separationEnabled) {
  const foodItems = lineItemsForWorkflow(sourceOrder, 'orders', separationEnabled);
  const essentialsItems = lineItemsForWorkflow(sourceOrder, 'essentials', separationEnabled);
  const foodComplete = foodItems.length === 0 || Boolean(foodRecord && foodRecord.completedAt);
  const essentialsComplete = essentialsItems.length === 0 || Boolean(essentialsRecord && essentialsRecord.completedAt);
  return {
    foodComplete,
    essentialsComplete,
    allComplete: foodComplete && essentialsComplete,
    waitingForWorkflow: foodComplete && essentialsComplete
      ? null
      : (foodComplete ? 'essentials' : 'orders'),
  };
}

// A second order placed during the same picking day may change the merged
// order ID without invalidating scans. A new local order on a later Eastern
// calendar day is a different delivery cycle and must start fresh.
const easternDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});
function shouldStartNewPickingRecord(existing, order) {
  if (!existing) return true;
  if (existing.orderId === order.orderId) return false;
  if (existing.completedAt || !existing.startedAt) return true;
  if (order.isB2B) return false;
  const startedAt = Date.parse(existing.startedAt);
  const createdAt = Date.parse(order.createdAt);
  return Number.isFinite(startedAt) && Number.isFinite(createdAt) &&
    startedAt < createdAt && easternDay.format(startedAt) !== easternDay.format(createdAt);
}

module.exports = {
  lineItemsForWorkflow,
  normalizePickingWorkflow,
  workflowCompletion,
  shouldStartNewPickingRecord,
};
