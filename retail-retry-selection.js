// Selection is applied only AFTER the complete saved receipt is validated.
// It never substitutes a partial payload for the authoritative receipt.
function selectedRetailBatches(batches, caseSkus) {
  if (caseSkus === undefined) return batches;
  const all = batches.flatMap(b => b.lines.map(l => l.caseSku));
  if (!Array.isArray(caseSkus) || !caseSkus.length || new Set(caseSkus).size !== caseSkus.length ||
      caseSkus.some(s => typeof s !== 'string' || all.filter(x => x === s).length !== 1)) {
    throw new Error('Exact unique saved retail SKUs required for a scoped retry');
  }
  return batches.map(b => ({...b, lines: b.lines.filter(l => caseSkus.includes(l.caseSku))}));
}
module.exports = { selectedRetailBatches };
