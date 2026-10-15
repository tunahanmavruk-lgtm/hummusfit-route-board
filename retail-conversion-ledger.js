const fs = require('node:fs');

function validateLedger(ledger) {
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) {
    throw new Error('Invalid conversion history');
  }
  for (const [key, entry] of Object.entries(ledger)) {
    if (!/^[a-f0-9]{64}$/.test(key) || !entry || typeof entry !== 'object' ||
        !['pending', 'posted', 'failed'].includes(entry.status) ||
        !entry.store || !entry.orderId || !entry.caseSku ||
        !Number.isSafeInteger(entry.plan?.receivedCases) || entry.plan.receivedCases <= 0 ||
        !Number.isSafeInteger(entry.plan?.units) || entry.plan.units <= 0 ||
        entry.plan.input?.referenceDocumentUri !== `gid://hummusfit-receiving/CaseConversion/${key}` ||
        !Array.isArray(entry.plan.input?.changes) || entry.plan.input.changes.length !== 2 ||
        (entry.status === 'posted' && (!entry.adjustmentId || entry.units !== entry.plan.units))) {
      throw new Error('Invalid conversion history entry');
    }
  }
  return ledger;
}

function readConversionLedger(file) {
  try {
    return validateLedger(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (cause) {
    // Missing history is not a new installation: it may contain already-posted
    // corrections. Never reconstruct it as empty or auto-restore a stale backup.
    throw new Error('Case conversion stopped: saved conversion history is missing, unreadable, or invalid. Review and restore verified history before retrying.', { cause });
  }
}

function writeConversionLedger(file, ledger) {
  validateLedger(ledger);
  const temporary = `${file}.${process.pid}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temporary, 'w', 0o600);
    fs.writeFileSync(fd, JSON.stringify(ledger, null, 2));
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  fs.renameSync(temporary, file);
  // Persist the rename as well as the contents before any Shopify request.
  const directory = fs.openSync(require('node:path').dirname(file), 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}

module.exports = { readConversionLedger, writeConversionLedger, validateLedger };
