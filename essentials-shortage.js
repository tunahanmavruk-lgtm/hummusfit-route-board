// Essentials cases are labeled one at a time. A shortage may account only for
// the cases that have already been labeled; it must never invent picked cases.
function validateEssentialsStatus(status, pickedQty, labeledCount, orderedCount) {
  if (!Number.isSafeInteger(labeledCount) || labeledCount < 0 ||
      !Number.isSafeInteger(orderedCount) || orderedCount < 1 || labeledCount > orderedCount) {
    return "Essentials case counts need review before changing this item.";
  }
  if (status === "missing") {
    return labeledCount === 0 ? null : "Cases are already labeled. Mark the remaining cases short instead.";
  }
  if (status === "partial") {
    return Number.isSafeInteger(pickedQty) && pickedQty === labeledCount &&
      labeledCount > 0 && labeledCount < orderedCount
      ? null : "Label each available case first, then mark the remaining cases short.";
  }
  if (status === "picked") {
    return labeledCount === orderedCount ? null : "Label all ordered cases before marking Essentials picked.";
  }
  if (status === "not_picked") {
    return labeledCount < orderedCount ? null : "All ordered cases are already labeled.";
  }
  return "Invalid Essentials item status.";
}

function essentialsLineResolved(status, pickedQty, labeledCount, orderedCount) {
  return status !== "not_picked" &&
    validateEssentialsStatus(status, pickedQty, labeledCount, orderedCount) === null;
}

module.exports = { validateEssentialsStatus, essentialsLineResolved };
