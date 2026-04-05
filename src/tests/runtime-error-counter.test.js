"use strict";

const assert = require("assert");
const {
  isNonRuntimeLiveReject,
  normalizeOperationalReason,
  resolveIntentCancelOperationalFamily,
  summarizeRuntimeErrorFamilies,
} = require("../../scripts/lib/runtime-error-counter");

function run() {
  assert.strictEqual(normalizeOperationalReason("BINANCEFUT_KEYS_MISSING"), "BINANCEFUT_KEYS_MISSING");
  assert.strictEqual(normalizeOperationalReason("DROP_COMMISSION_GATE_ERROR"), "DROP_COMMISSION_GATE_ERROR");
  assert.strictEqual(normalizeOperationalReason("TV_WEBHOOK"), null);
  assert.strictEqual(normalizeOperationalReason("DROP_SHORT_GATE_SCORE"), null);
  assert.strictEqual(
    isNonRuntimeLiveReject({
      cancel_reason: "LIVE_EXCEPTION",
      cancel_note: "msg=BINANCEFUT_HTTP_400: {\"code\":-2019,\"msg\":\"Margin is insufficient.\"}",
    }),
    true
  );
  assert.strictEqual(
    resolveIntentCancelOperationalFamily({
      cancel_reason: "LIVE_EXCEPTION",
      cancel_note: "msg=BINANCEFUT_HTTP_400: {\"code\":-2019,\"msg\":\"Margin is insufficient.\"}",
    }),
    null
  );

  const summary = summarizeRuntimeErrorFamilies({
    intentCancels: [
      {
        status: "FAILED_INTERNAL",
        cancel_reason: "BINANCEFUT_KEYS_MISSING",
        symbol_or_pair_id: "ETHUSDT",
        updated_at: "2026-03-23T03:54:27.000Z",
      },
      {
        status: "TIMEOUT_PROVIDER",
        cancel_reason: "BINANCEFUT_KEYS_MISSING",
        symbol_or_pair_id: "AXSUSDT",
        updated_at: "2026-03-23T03:55:35.000Z",
      },
      {
        status: "REJECTED_PROVIDER",
        cancel_reason: "MARGIN_TYPE_SET_FAILED",
        symbol_or_pair_id: "SOLUSDT",
        updated_at: "2026-03-23T06:21:39.000Z",
      },
      {
        status: "CANCELED",
        cancel_reason: "LIVE_EXCEPTION",
        cancel_note: "msg=BINANCEFUT_HTTP_400: {\"code\":-2019,\"msg\":\"Margin is insufficient.\"}",
        symbol_or_pair_id: "SOLUSDT",
        updated_at: "2026-03-23T06:22:39.000Z",
      },
    ],
    droppedSignals: [
      {
        reason: "TV_WEBHOOK",
        symbol_or_pair_id: "BTCUSDT",
        created_at: "2026-03-23T00:00:00.000Z",
      },
      {
        reason: "DROP_COMMISSION_GATE_ERROR",
        symbol_or_pair_id: "BTCUSDT",
        created_at: "2026-03-23T00:05:00.000Z",
      },
    ],
    gateEvents: [
      {
        status: "FAIL",
        severity: "HARD",
        reason_codes: ["DNS_PRECHECK_FAILED"],
        market: "BTCUSDT",
        created_at: "2026-03-23T00:10:00.000Z",
      },
    ],
    aiRuns: [
      {
        created_at: "2026-03-23T00:30:00.000Z",
        news_ok: false,
        news_reason: "HTTP_429",
        gpt_attempted: true,
        gpt_ok: false,
        gpt_error: "HTTP_429",
        claude_attempted: true,
        claude_ok: true,
        applied: true,
        live_ok: false,
        live_reason: "WRITE_FAILED",
      },
    ],
  });

  assert.strictEqual(summary.error_count_24h, 7);
  assert.strictEqual(summary.error_occurrence_count_24h, 8);
  assert.ok(summary.error_families_24h.some((item) => item.family === "BINANCEFUT_KEYS_MISSING" && item.count === 2));
  assert.ok(summary.error_families_24h.some((item) => item.family === "MARGIN_TYPE_SET_FAILED"));
  assert.ok(summary.error_families_24h.some((item) => item.family === "DROP_COMMISSION_GATE_ERROR"));
  assert.ok(summary.error_families_24h.some((item) => item.family === "DNS_PRECHECK_FAILED"));
  assert.ok(summary.error_families_24h.some((item) => item.family === "AI_NEWS_FETCH_FAILED"));
  assert.ok(summary.error_families_24h.some((item) => item.family === "AI_GPT_FAILED"));
  assert.ok(summary.error_families_24h.some((item) => item.family === "AI_LIVE_APPLY_FAILED"));
}

try {
  run();
  console.log("RUNTIME_ERROR_COUNTER_TEST_OK");
} catch (err) {
  console.error("RUNTIME_ERROR_COUNTER_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
