#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

function readJsonSafe(filePath) {
  try {
    const text = fs.readFileSync(filePath, "utf8");
    return { ok: true, data: JSON.parse(text), text };
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? err.message : String(err),
      data: null,
      text: "",
    };
  }
}

function toNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round(v, digits = 4) {
  if (!Number.isFinite(v)) return null;
  const p = 10 ** digits;
  return Math.round(v * p) / p;
}

function pick(obj, pathArr) {
  let cur = obj;
  for (const key of pathArr) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = cur[key];
  }
  return cur;
}

function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const microPath = path.join(repoRoot, "ops", "daily", "execution_microstructure_latest.json");
  const ledgerPath = path.join(repoRoot, "noye", "role_trade_ledger_latest.json");
  const outputPath = path.join(repoRoot, "data", "improvement_pack.json");

  const micro = readJsonSafe(microPath);
  const ledger = readJsonSafe(ledgerPath);

  const warnings = [];
  const slippageP95 = toNum(pick(micro.data, ["metrics", "slippage", "adverse_p95_bps"]), null);
  const slippageMean = toNum(pick(micro.data, ["metrics", "slippage", "adverse_mean_bps"]), null);
  const totalNotional = toNum(pick(micro.data, ["metrics", "fee", "total_notional"]), null);

  let slippageBps = slippageP95;
  if (!Number.isFinite(slippageBps)) slippageBps = slippageMean;
  if (!Number.isFinite(slippageBps)) {
    slippageBps = 0;
    warnings.push("slippage_bps_missing");
  }

  let orderCount = toNum(pick(ledger.data, ["counts", "order_resolved"]), null);
  if (!Number.isFinite(orderCount)) orderCount = toNum(pick(ledger.data, ["counts", "trades"]), null);
  if (!Number.isFinite(orderCount)) warnings.push("order_count_missing");

  const slippagePaidEstimate = (Number.isFinite(totalNotional) && Number.isFinite(slippageBps))
    ? round((totalNotional * slippageBps) / 10000, 6)
    : null;

  const payload = {
    schema: "donbeolja_improvement_pack_v1",
    generated_at_iso: new Date().toISOString(),
    source: "local_fallback_execution_microstructure",
    slippage_bps: round(slippageBps, 4),
    slippage_paid: Number.isFinite(slippagePaidEstimate) ? slippagePaidEstimate : 0,
    slippage_paid_estimate: slippagePaidEstimate,
    order_count: Number.isFinite(orderCount) ? Math.trunc(orderCount) : null,
    metrics: micro.ok ? micro.data.metrics || {} : {},
    notes: micro.ok
      ? "Derived from ops/daily/execution_microstructure_latest.json"
      : "Fallback payload (microstructure data missing)",
    warnings,
    sources: {
      execution_microstructure_latest: micro.ok ? microPath : null,
      role_trade_ledger_latest: ledger.ok ? ledgerPath : null,
    },
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    ok: true,
    output_json: outputPath,
    slippage_bps: payload.slippage_bps,
    order_count: payload.order_count,
    warnings,
  }));
}

try {
  main();
} catch (err) {
  console.error("build-improvement-pack-local failed:", err && err.message ? err.message : err);
  process.exit(1);
}
