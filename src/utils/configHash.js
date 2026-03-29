// src/utils/configHash.js
const crypto = require("crypto");

// tick에 영향을 주는 키만 고정 목록으로 해시한다.
const KEYSET = [
  "BINANCEFUT_MARKETS",
  "BINANCEFUT_BLOCKED_MARKETS",
  "SCHEDULE_POLL_MS",
  "SCHEDULE_GRACE_MS",
  "ENGINE_VERSION",
  "RUNTIME_MODE",
  "FEE_BPS",
  "SLIPPAGE_BPS",
  "FUNDING_BPS_PER_8H",
  "GOOGLE_CLOUD_PROJECT",
  "TAILSCALE_AUTH_BYPASS",
  "ACCESS_SCOPE",
  "BASE_URL",
];

function buildConfigObject(env = process.env) {
  const obj = {};
  for (const k of KEYSET) obj[k] = env[k] ?? null;
  return obj;
}

function configHash(env = process.env) {
  const obj = buildConfigObject(env);
  const json = JSON.stringify(obj);
  return crypto.createHash("sha256").update(json).digest("hex");
}

module.exports = { KEYSET, buildConfigObject, configHash };
