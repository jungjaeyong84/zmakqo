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
const os = require("os");

// Isolate this test from the production ops/daily/ path. Before this
// isolation the test fixtures (openclaw_{evidence_linker,calibration,
// retrospect}_latest.json) were written into the real repo path and then
// unlinked on cleanup — which silently WIPED the live cron artifacts and
// made the dashboard flip to RED until the next cron fired. Now the test
// writes fixtures under a unique tmp dir and points the dashboard route at
// it via OPENCLAW_DASHBOARD_OPS_DAILY_DIR.
const OPS_DAILY = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-dashboard-test-"));
process.env.OPENCLAW_DASHBOARD_OPS_DAILY_DIR = OPS_DAILY;

function fakeRes() {
  const state = { statusCode: 200, body: null, headers: {}, renderedView: null, renderedLocals: null };
  return {
    state,
    json(payload) {
      state.body = payload;
      return payload;
    },
    send(payload) {
      state.body = payload;
      return payload;
    },
    setHeader(k, v) {
      state.headers[String(k).toLowerCase()] = v;
    },
    status(code) {
      state.statusCode = code;
      return this;
    },
    // The HTML view now delegates to res.render('openclaw', locals) so the
    // page can inherit the shared sidebar/topbar from app_start_unified.
    // The test doesn't boot an EJS engine — we just capture the render call
    // and assert the locals carry a valid payload to the template.
    render(view, locals) {
      state.renderedView = view;
      state.renderedLocals = locals;
      state.body = { view, locals };
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
  return res;
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

  // Fixture: write an evidence_linker artifact into the isolated tmp dir
  // so the dashboard picks it up as status=ok. Calibration and retrospect
  // are intentionally not created so we exercise the graceful-degradation
  // path. No cleanup needed — the whole tmp dir is removed at the end.
  const linkerPath = path.join(OPS_DAILY, "openclaw_evidence_linker_latest.json");
  fs.writeFileSync(linkerPath, JSON.stringify({
    generated_at: "2026-04-18T00:00:00.000Z",
    counts: { linked: 5, tp1_first: 1, sl_first: 4 },
    dry_run: false,
  }), "utf8");

  const router = require("../routes/dashboard.openclaw.routes");
  const jsonRes = callRoute(router, "/dashboard/openclaw");
  const body = jsonRes.state.body;

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

  // ── HTML view (/dashboard/openclaw/view) ──────────────────────────
  // View now delegates to res.render('openclaw', { payload }) so the page
  // inherits the canonical sidebar + topbar + CSS tokens from
  // src/views/partials/app_start_unified.ejs. We assert:
  //   - the correct view name is rendered,
  //   - the payload locals match the JSON-endpoint payload shape,
  //   - Cache-Control is no-store (so each reload shows fresh artifact state).
  fs.writeFileSync(linkerPath, JSON.stringify({
    generated_at: "2026-04-18T00:00:00.000Z",
    counts: { linked: 5, tp1_first: 1, sl_first: 4 },
    dry_run: false,
  }), "utf8");
  const htmlRes = callRoute(router, "/dashboard/openclaw/view");
  assert.strictEqual(htmlRes.state.renderedView, "openclaw",
    `expected view=openclaw, got ${htmlRes.state.renderedView}`);
  const locals = htmlRes.state.renderedLocals || {};
  assert.ok(locals.payload && typeof locals.payload === "object", "locals.payload missing");
  assert.strictEqual(locals.payload.ok, true, "payload.ok must be true");
  assert.ok(locals.payload.artifacts && locals.payload.artifacts.evidence_linker,
    "payload.artifacts.evidence_linker missing");
  assert.ok(locals.payload.phase, "payload.phase missing");
  assert.ok(locals.payload.evidence && Array.isArray(locals.payload.evidence.tail),
    "payload.evidence.tail must be an array");
  assert.strictEqual(
    String(htmlRes.state.headers["cache-control"] || "").toLowerCase(),
    "no-store, max-age=0",
    "HTML view must be uncached"
  );
  // Sanity-render the EJS template itself (no express app required) so a
  // compile error in src/views/openclaw.ejs fails this test — otherwise the
  // template only breaks at runtime.
  const ejs = require("ejs");
  const ejsPath = path.resolve(__dirname, "..", "views", "openclaw.ejs");
  const renderedHtml = await ejs.renderFile(
    ejsPath,
    Object.assign({}, locals, { cache: false }),
    { async: true }
  );
  assert.ok(typeof renderedHtml === "string" && renderedHtml.length > 500, "EJS render must return non-empty HTML");
  assert.ok(renderedHtml.includes("OpenClaw AI 에이전트"), "EJS must render hero title");
  assert.ok(renderedHtml.includes("Phase 플래그"), "EJS must render phase section");
  assert.ok(renderedHtml.includes("Evidence Ledger"), "EJS must render evidence section");

  // Clean up: remove the entire isolated tmp dir in one shot.
  ledger.__test.resetLedgerForTest();
  try { fs.rmSync(OPS_DAILY, { recursive: true, force: true }); } catch (_) {}

  console.log("DASHBOARD_OPENCLAW_ROUTE_TEST_OK");
})().catch((err) => {
  // Best-effort cleanup even on failure so tmp dirs don't accumulate.
  try { fs.rmSync(OPS_DAILY, { recursive: true, force: true }); } catch (_) {}
  console.error("DASHBOARD_OPENCLAW_ROUTE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
