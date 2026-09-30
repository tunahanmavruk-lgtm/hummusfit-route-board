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

module.exports = {
  lineItemsForWorkflow,
  normalizePickingWorkflow,
  workflowCompletion,
};
