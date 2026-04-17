"use strict";

// /dashboard/openclaw monitoring route — exercises the JSON handler with
// a known artifact fixture and with missing artifacts, and checks that:
//   - each of the three expected artifact keys (evidence_linker /
//     calibration / retrospect) is present in the response;
//   - a missing artifact reports status="missing" instead of throwing;
//   - the stale-ness stat is computed (age_hours present);
//   - the evidence-ledger tail reflects records pushed into the ring
//     buffer before the route was hit;
//   - the phase block reports the current env flags, so the operator
//     can audit which phase is live.

const assert = require("assert");
const path = require("path");
const fs = require("fs");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OPS_DAILY = path.join(REPO_ROOT, "ops", "daily");

function fakeRes() {
  const state = { statusCode: 200, body: null };
  return {
    state,
    json(payload) {
      state.body = payload;
      return payload;
    },
    status(code) {
      state.statusCode = code;
      return this;
    },
  };
}

function callRoute(router, url = "/dashboard/openclaw") {
  // express Router exposes its stack directly; find our GET handler.
  const layer = router.stack.find((l) => l.route && l.route.path === url);
  assert.ok(layer, `route not registered: ${url}`);
  const handler = layer.route.stack[0].handle;
  const res = fakeRes();
  handler({ query: {} }, res, () => {});
  return res.state.body;
}

(async function run() {
  // Reset the evidence ledger and write a single decision record so the
  // tail is non-empty when the route is called.
  const { writeEvidenceRecord, KINDS, resetLedgerForTest } = require("../services/openclawEvidenceLedger").__test
    ? require("../services/openclawEvidenceLedger")
    : {};
  // reset first — __test.resetLedgerForTest is exposed via __test export.
  const ledger = require("../services/openclawEvidenceLedger");
  ledger.__test.resetLedgerForTest();
  await ledger.writeEvidenceRecord({
    decision_id: "test-dec-1",
    kind: "SIGNAL_DECIDER",
    decision: "ACCEPT",
    confidence: 0.7,
    symbol: "BTCUSDT",
    market: "binance_futures",
    tf_exec: "3m",
    rule_verdict: "ACCEPT",
    narrative_verdict: null,
  });

  // Fixture: write an evidence_linker artifact with a known generated_at
  // so we can confirm the summary picks it up, but leave calibration and
  // retrospect missing so we exercise the graceful-degradation path.
  fs.mkdirSync(OPS_DAILY, { recursive: true });
  const linkerPath = path.join(OPS_DAILY, "openclaw_evidence_linker_latest.json");
  fs.writeFileSync(linkerPath, JSON.stringify({
    generated_at: "2026-04-18T00:00:00.000Z",
    counts: { linked: 5, tp1_first: 1, sl_first: 4 },
    dry_run: false,
  }), "utf8");
  // Delete the other two to guarantee they are missing.
  for (const name of ["openclaw_calibration_latest.json", "openclaw_retrospect_latest.json"]) {
    try { fs.unlinkSync(path.join(OPS_DAILY, name)); } catch (_) {}
  }

  const router = require("../routes/dashboard.openclaw.routes");
  const body = callRoute(router, "/dashboard/openclaw");

  assert.strictEqual(body.ok, true, "route must report ok:true");
  assert.ok(body.artifacts && typeof body.artifacts === "object", "artifacts block missing");
  for (const key of ["evidence_linker", "calibration", "retrospect"]) {
    assert.ok(key in body.artifacts, `artifacts.${key} missing`);
  }

  // evidence_linker should be readable (status=ok) with a generated_at.
  const linker = body.artifacts.evidence_linker;
  assert.strictEqual(linker.status, "ok", `evidence_linker status=${linker.status}`);
  assert.strictEqual(linker.summary.generated_at, "2026-04-18T00:00:00.000Z");
  assert.strictEqual(linker.summary.counts.linked, 5);
  assert.ok(linker.stat && typeof linker.stat.age_hours === "number");

  // calibration and retrospect are missing → status="missing".
  assert.strictEqual(body.artifacts.calibration.status, "missing");
  assert.strictEqual(body.artifacts.retrospect.status, "missing");

  // Health: at least one unhealthy -> amber or red.
  assert.ok(["AMBER", "RED"].includes(body.health.color),
    `expected AMBER or RED, got ${body.health.color}`);

  // Evidence tail must include our seeded record.
  assert.ok(body.evidence.buffer_size >= 1, "evidence buffer must contain the seeded record");
  assert.strictEqual(body.evidence.tail[0].decision_id, "test-dec-1");
  assert.strictEqual(body.evidence.tail[0].kind, "SIGNAL_DECIDER");

  // Phase block must exist (regardless of current env values).
  assert.ok(body.phase && typeof body.phase === "object", "phase block missing");
  assert.strictEqual(typeof body.phase.narrative_enabled, "boolean");
  assert.strictEqual(typeof body.phase.narrative_provider_mode, "string");

  // Clean up the fixture.
  try { fs.unlinkSync(linkerPath); } catch (_) {}
  ledger.__test.resetLedgerForTest();

  console.log("DASHBOARD_OPENCLAW_ROUTE_TEST_OK");
})().catch((err) => {
  console.error("DASHBOARD_OPENCLAW_ROUTE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
