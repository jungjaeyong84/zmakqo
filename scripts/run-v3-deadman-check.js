#!/usr/bin/env node
"use strict";

// scripts/run-v3-deadman-check.js — pipeline heartbeat watchdog (2026-07-16).
//
// "Silence is not success." Every v3 cycle rewrites its artifact each tick,
// so artifact age = pipeline liveness. Alerts on healthy→stale transitions,
// re-alerts every 6h while stale, and sends a recovery notice.
//
// HONEST LIMIT: runs on the same machine — catches partial death (a wedged
// job, disk full, revoked keys) but NOT whole-machine death. See README.

try { require("dotenv").config(); } catch (_) {}

const fs = require("fs");
const path = require("path");
const { checkArtifacts } = require("../src/v3/deadmanCheck");
const { alertOnce } = require("../src/v3/opsAlert");

const ROOT = path.resolve(__dirname, "..");
const ALERT_STATE = path.join(ROOT, "ops/runtime/v3_ops_alert_state.json");
const OUT = path.join(ROOT, "ops/daily/v3_deadman_latest.json");

const DESCRIPTORS = [
  // paper cycle regenerates this every 180s tick regardless of trades
  { name: "v3paper_cycle", path: path.join(ROOT, "ops/daily/v3_paper_performance_latest.json"), max_age_ms: 15 * 60 * 1000 },
  // live cycle's report step always runs (even fully inert)
  { name: "v3live_cycle", path: path.join(ROOT, "ops/daily/v3_live_vs_paper_latest.json"), max_age_ms: 15 * 60 * 1000 },
  // readiness watcher runs 2x daily + on load
  { name: "v3ready_watch", path: path.join(ROOT, "ops/runtime/v3_readiness_watch_state.json"), max_age_ms: 26 * 60 * 60 * 1000 },
  // funding monitor runs hourly (2h10m allowance for one missed tick)
  { name: "v3funding_monitor", path: path.join(ROOT, "ops/daily/v3_funding_monitor_latest.json"), max_age_ms: 130 * 60 * 1000 },
];

async function main() {
  const result = checkArtifacts(DESCRIPTORS);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), ...result }, null, 2));

  for (const d of DESCRIPTORS) {
    const staleEntry = result.stale.find((s) => s.name === d.name);
    await alertOnce({
      stateFile: ALERT_STATE,
      key: `deadman_${d.name}`,
      active: !!staleEntry,
      title: `🚨 v3 데드맨: ${d.name} 심박 정지`,
      severity: "error",
      recoveryTitle: `✅ v3 데드맨: ${d.name} 심박 회복`,
      rearmMs: 6 * 60 * 60 * 1000,
      body: staleEntry
        ? (staleEntry.missing
          ? `${d.name} 아티팩트가 존재하지 않음 (${d.path})`
          : `${d.name} 아티팩트가 ${Math.round(staleEntry.age_ms / 60000)}분째 갱신 안 됨 (허용 ${Math.round(d.max_age_ms / 60000)}분)`)
        : `${d.name} 정상`,
    });
  }

  console.log(JSON.stringify({ ok: result.ok, stale: result.stale.map((s) => s.name), latest_json: OUT }));
}

if (require.main === module) {
  main().catch((e) => {
    console.error("RUN_V3_DEADMAN_CHECK_FAIL", e && e.stack ? e.stack : String(e));
    process.exit(1);
  });
}
