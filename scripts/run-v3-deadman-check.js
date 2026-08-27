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

// 2026-08-07 — the v3 directional lane was retired. Its edge did not survive
// the controls: the book ran 64% short and a regression of weekly win rate on
// BTC's weekly return gives R2 = 0.705, so the "win rate" was market beta, and
// every profitable subset traced back to one -14% BTC week in June. The
// v3paper / v3live / v3readywatch jobs are booted out, so their heartbeats are
// gone BY DESIGN and must not be watched — a descriptor for a job that is
// supposed to be stopped is a permanent false alarm, which is how deadmen get
// muted and then ignored.
//
// What remains is the infrastructure that outlived the strategy it was built
// for: the funding monitor (now the primary lane) and the v4 paper lane.
const DESCRIPTORS = [
  // funding monitor runs hourly (2h10m allowance for one missed tick)
  { name: "v3funding_monitor", path: path.join(ROOT, "ops/daily/v3_funding_monitor_latest.json"), max_age_ms: 130 * 60 * 1000 },
  // v4 cross-sectional lane rebalances daily (26h allowance for one miss)
  { name: "v4paper_lane", path: path.join(ROOT, "ops/daily/v4_paper_latest.json"), max_age_ms: 26 * 60 * 60 * 1000 },
  // Flow collector moved to a 4h cadence on 2026-08-21 so v7 can act on a
  // period within one bar of it closing instead of waiting up to 12h for the
  // next of two daily runs. The 26h allowance was calibrated to that old
  // cadence and would now let six ticks pass unnoticed; 13h still tolerates
  // three misses and a sleeping machine while catching a real outage the same
  // day. The 30-day API horizon is still the thing being protected — a gap
  // longer than that can NEVER be backfilled.
  {
    name: "v5flow_collector",
    path: path.join(ROOT, "ops/daily/v5_flow_collector_latest.json"),
    max_age_ms: 13 * 60 * 60 * 1000,
    // A run where EVERY symbol failed still wrote this file on schedule, so
    // age alone reported healthy through a 25-hour outage. Partial failures
    // are tolerated — one symbol timing out is normal — but a run that banked
    // nothing while failing everything did no work at all.
    degraded: (doc) => {
      const failed = Array.isArray(doc.failures) ? doc.failures.length : 0;
      const symbols = Number(doc.symbols) || 0;
      if (symbols && failed >= symbols * 4) return `every fetch failed (${failed})`;
      return null;
    },
  },
  // v6 retired 2026-08-21 at 138 trades / -40.4% / verdict NEGATIVE. Its
  // heartbeat is gone BY DESIGN, so watching it would be a permanent false
  // alarm — the same reasoning that dropped the v3 descriptors.
  // v7 ticks hourly and is the lane actually under test — it was missing from
  // this list, which is the worst one to omit. 2h10m allows one missed tick.
  {
    name: "v7positioning_lane",
    path: path.join(ROOT, "ops/daily/v7_positioning_latest.json"),
    max_age_ms: 130 * 60 * 1000,
    // Same failure mode: 24 price fetches failed, the cycle exited 0, and the
    // report looked current. Booking nothing is NORMAL here (most ticks have
    // no closed period to act on), so the signal is failure count, not idleness.
    degraded: (doc) => {
      const failed = Array.isArray(doc.errors) ? doc.errors.length : 0;
      const symbols = Number(doc.symbols) || 0;
      if (symbols && failed >= symbols) return `every price fetch failed (${failed})`;
      return null;
    },
  },
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
      title: staleEntry && staleEntry.degraded_reason
        ? `🚨 데드맨: ${d.name} 실행되지만 작동 안 함`
        : `🚨 v3 데드맨: ${d.name} 심박 정지`,
      severity: "error",
      recoveryTitle: `✅ v3 데드맨: ${d.name} 심박 회복`,
      rearmMs: 6 * 60 * 60 * 1000,
      // Name the actual cause. A "heartbeat stopped" message for a job that is
      // running fine but failing every call sends the reader looking for a
      // dead process, which is the wrong place.
      body: staleEntry
        ? (staleEntry.missing
          ? `${d.name} 아티팩트가 존재하지 않음 (${d.path})`
          : staleEntry.degraded_reason
            ? `${d.name} 은 정시에 실행되고 파일도 갱신했지만 실제 작업은 실패: ${staleEntry.degraded_reason}`
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
