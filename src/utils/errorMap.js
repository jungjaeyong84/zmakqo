// src/utils/errorMap.js

function mapError(err, stageChain = []) {
  const msg = err?.message || String(err);

  // 최소 매핑
  let code = "ERR_UNKNOWN";

  if (/Unable to detect a Project Id/i.test(msg)) code = "ERR_GCP_PROJECT_ID";
  else if (/permission/i.test(msg) && /firestore/i.test(msg)) code = "ERR_FIRESTORE_PERMISSION";
  else if (/ECONNREFUSED/i.test(msg)) code = "ERR_CONN_REFUSED";
  else if (/timeout/i.test(msg)) code = "ERR_TIMEOUT";

  return {
    error_code: code,
    error_message: msg,
    error_chain: Array.isArray(stageChain) ? stageChain : [],
  };
}

module.exports = { mapError };
