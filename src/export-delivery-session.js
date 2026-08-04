let stagedExport = null;

function validateStagedExport(exportResult) {
  if (!exportResult || typeof exportResult !== 'object') {
    throw new TypeError('Export result không hợp lệ.');
  }
  if (typeof exportResult.filename !== 'string' || !exportResult.filename) {
    throw new TypeError('Export filename là bắt buộc.');
  }
  if (!(exportResult.bytes instanceof Uint8Array)) {
    throw new TypeError('Export bytes phải là Uint8Array.');
  }
  return exportResult;
}

export function stageExportForBundle(exportResult) {
  stagedExport = validateStagedExport(exportResult);
  return stagedExport;
}

export function consumeStagedExportForBundle() {
  const current = stagedExport;
  stagedExport = null;
  return current;
}

export function clearStagedExportForBundle() {
  stagedExport = null;
}

export function hasStagedExportForBundle() {
  return Boolean(stagedExport);
}
