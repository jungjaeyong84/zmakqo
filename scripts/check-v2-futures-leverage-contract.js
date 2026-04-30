"use strict";

const { getFirestore } = require("../src/storage/firestore");
const { getSystemSettingsForProvider } = require("../src/storage/settings");

function toPositiveNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function readExpectedLeverage(env = process.env) {
  return toPositiveNumber(env.V2_FUTURES_DEFAULT_LEVERAGE)
    || toPositiveNumber(env.DONBEOLJA_V2_FUTURES_DEFAULT_LEVERAGE)
    || 3;
}

async function main() {
  const provider = String(process.env.V2_FUTURES_LEVERAGE_CONTRACT_PROVIDER || "BINANCEFUT").trim().toUpperCase();
  const expected = readExpectedLeverage(process.env);
  const db = getFirestore();
  const snap = await db.collection("settings").doc("system").get();
  const raw = snap.exists ? (snap.data() || {}) : {};
  const providerRaw = raw.providers && typeof raw.providers === "object" && raw.providers[provider]
    ? raw.providers[provider]
    : null;
  const merged = await getSystemSettingsForProvider(provider, 0);
  const mergedData = merged && merged.data ? merged.data : {};

  const checks = [
    {
      id: "RAW_SYSTEM_FUTURES_LEVERAGE_MATCHES_V2_ENV",
      actual: toPositiveNumber(raw.futures_leverage),
      expected,
    },
    {
      id: "RAW_PROVIDER_FUTURES_LEVERAGE_MATCHES_V2_ENV",
      actual: toPositiveNumber(providerRaw && providerRaw.futures_leverage),
      expected,
    },
    {
      id: "MERGED_PROVIDER_FUTURES_LEVERAGE_MATCHES_V2_ENV",
      actual: toPositiveNumber(mergedData.futures_leverage),
      expected,
    },
  ].map((check) => ({
    ...check,
    ok: check.actual === check.expected,
  }));

  const failed = checks.filter((check) => check.ok !== true);
  const result = {
    ok: failed.length === 0,
    reason: failed.length === 0
      ? "V2_FUTURES_LEVERAGE_CONTRACT_PASS"
      : "V2_FUTURES_LEVERAGE_CONTRACT_BLOCKED",
    provider,
    expected_leverage: expected,
    blockers: failed.map((check) => `V2_FUTURES_LEVERAGE:${check.id}`),
    checks,
    firestore_doc_exists: snap.exists === true,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    reason: "V2_FUTURES_LEVERAGE_CONTRACT_ERROR",
    error_message: error && error.message ? error.message : String(error),
  }, null, 2));
  process.exit(1);
});
