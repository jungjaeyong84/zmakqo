"use strict";

const assert = require("assert");
const {
  isNonRuntimeLiveReject,
  normalizeOperationalReason,
  resolveIntentCancelOperationalFamily,
  isRetryableInfraOperationalDetail,
  resolveOperationalActiveWindowMs,
  isOperationalFamilyActive,
  summarizeRuntimeErrorFamilies,
} = require("../../scripts/lib/runtime-error-counter");

function run() {
  assert.strictEqual(normalizeOperationalReason("BINANCEFUT_KEYS_MISSING"), "BINANCEFUT_KEYS_MISSING");
  assert.strictEqual(normalizeOperationalReason("DROP_COMMISSION_GATE_ERROR"), "DROP_COMMISSION_GATE_ERROR");
  assert.strictEqual(normalizeOperationalReason("TV_WEBHOOK"), null);
  assert.strictEqual(normalizeOperationalReason("DROP_SHORT_GATE_SCORE"), null);
  assert.strictEqual(isRetryableInfraOperationalDetail("EGRESS_PROXY_TIMEOUT provider=binancefut"), true);
  assert.strictEqual(isRetryableInfraOperationalDetail("BINANCEFUT_HTTP_400 code=-2022"), false);
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
  assert.strictEqual(
    isNonRuntimeLiveReject({
      cancel_reason: "LIVE_EXCEPTION",
      cancel_note: "msg=BINANCEFUT_HTTP_400: {\"code\":-2022,\"msg\":\"ReduceOnly Order is rejected.\"}",
    }),
    true
  );
  assert.strictEqual(
    resolveIntentCancelOperationalFamily({
      cancel_reason: "LIVE_EXCEPTION",
      cancel_note: "msg=BINANCEFUT_HTTP_400: {\"code\":-2022,\"msg\":\"ReduceOnly Order is rejected.\"}",
    }),
    null
  );

  const summary = summarizeRuntimeErrorFamilies({
    nowMs: Date.parse("2026-03-23T01:00:00.000Z"),
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
    positionWriterAuthorityEvents: [
      {
        code: "POSITION_WRITE_TOKEN_MISMATCH",
        symbol: "XRPUSDT",
        created_at: "2026-03-23T00:40:00.000Z",
        error: "POSITION_WRITE_TOKEN_MISMATCH expected=a actual=b",
      },
    ],
  });

  assert.strictEqual(summary.error_count_24h, 8);
  assert.strictEqual(summary.error_occurrence_count_24h, 9);
  assert.strictEqual(summary.active_error_count_24h, 8);
  assert.strictEqual(summary.active_error_occurrence_count_24h, 9);
  assert.ok(summary.error_families_24h.some((item) => item.family === "BINANCEFUT_KEYS_MISSING" && item.count === 2));
  assert.ok(summary.error_families_24h.some((item) => item.family === "MARGIN_TYPE_SET_FAILED"));
  assert.ok(summary.error_families_24h.some((item) => item.family === "DROP_COMMISSION_GATE_ERROR"));
  assert.ok(summary.error_families_24h.some((item) => item.family === "DNS_PRECHECK_FAILED"));
  assert.ok(summary.error_families_24h.some((item) => item.family === "AI_NEWS_FETCH_FAILED"));
  assert.ok(summary.error_families_24h.some((item) => item.family === "AI_GPT_FAILED"));
  assert.ok(summary.error_families_24h.some((item) => item.family === "AI_LIVE_APPLY_FAILED"));
  assert.ok(summary.error_families_24h.some((item) => item.family === "POSITION_WRITE_TOKEN_MISMATCH" && item.count === 1));
  const writerSingle = summary.error_families_24h.find((item) => item.family === "POSITION_WRITE_TOKEN_MISMATCH");
  assert.strictEqual(resolveOperationalActiveWindowMs(writerSingle), 90 * 60 * 1000);

  const staleTransient = summarizeRuntimeErrorFamilies({
    nowMs: Date.parse("2026-04-11T11:05:23.704Z"),
    intentCancels: [
      {
        status: "FAILED_INTERNAL",
        cancel_reason: "LIVE_EXCEPTION",
        cancel_note: "EGRESS_PROXY_TIMEOUT provider=binancefut action=fetchFuturesExchangeInfo",
        symbol_or_pair_id: "BNBUSDT",
        updated_at: "2026-04-10T21:19:24.616Z",
      },
      {
        status: "REJECTED_PROVIDER",
        cancel_reason: "LEVERAGE_SET_FAILED",
        cancel_note: "EGRESS_PROXY_TIMEOUT provider=binancefut action=setFuturesLeverage",
        symbol_or_pair_id: "AXSUSDT",
        updated_at: "2026-04-10T18:04:44.116Z",
      },
    ],
  });
  assert.strictEqual(staleTransient.error_count_24h, 2);
  assert.strictEqual(staleTransient.active_error_count_24h, 0);
  assert.strictEqual(resolveOperationalActiveWindowMs(staleTransient.error_families_24h[0]), 6 * 60 * 60 * 1000);
  assert.strictEqual(isOperationalFamilyActive(staleTransient.error_families_24h[0], Date.parse("2026-04-11T11:05:23.704Z")), false);

  const staleWriterSingle = summarizeRuntimeErrorFamilies({
    nowMs: Date.parse("2026-04-11T15:00:00.000Z"),
    positionWriterAuthorityEvents: [
      {
        code: "POSITION_WRITE_TOKEN_MISMATCH",
        symbol: "ETHUSDT",
        created_at: "2026-04-11T12:45:14.484Z",
        error: "POSITION_WRITE_TOKEN_MISMATCH expected=a actual=b",
      },
    ],
  });
  assert.strictEqual(staleWriterSingle.error_count_24h, 1);
  assert.strictEqual(staleWriterSingle.active_error_count_24h, 0);

  const repeatedWriter = summarizeRuntimeErrorFamilies({
    nowMs: Date.parse("2026-04-11T15:00:00.000Z"),
    positionWriterAuthorityEvents: [
      {
        code: "POSITION_WRITE_TOKEN_MISMATCH",
        symbol: "ETHUSDT",
        created_at: "2026-04-11T12:45:14.484Z",
        error: "POSITION_WRITE_TOKEN_MISMATCH expected=a actual=b",
      },
      {
        code: "POSITION_WRITE_TOKEN_MISMATCH",
        symbol: "XRPUSDT",
        created_at: "2026-04-11T14:15:14.484Z",
        error: "POSITION_WRITE_TOKEN_MISMATCH expected=c actual=d",
      },
    ],
  });
  const repeatedFamily = repeatedWriter.error_families_24h.find((item) => item.family === "POSITION_WRITE_TOKEN_MISMATCH");
  assert.strictEqual(resolveOperationalActiveWindowMs(repeatedFamily), 6 * 60 * 60 * 1000);
  assert.strictEqual(repeatedWriter.active_error_count_24h, 1);

  const suppressedWriter = summarizeRuntimeErrorFamilies({
    nowMs: Date.parse("2026-04-11T15:00:00.000Z"),
    positionWriterAuthorityEvents: [
      {
        code: "POSITION_WRITE_TOKEN_MISMATCH",
        symbol: "DOGEUSDT",
        created_at: "2026-04-11T14:55:14.484Z",
        runtime_family_suppressed: true,
        error: "POSITION_WRITE_TOKEN_MISMATCH expected=e actual=f",
      },
      {
        code: "POSITION_WRITE_TOKEN_MISMATCH",
        symbol: "BTCUSDT",
        created_at: "2026-04-11T14:56:14.484Z",
        resolved_at: "2026-04-11T14:58:14.484Z",
        error: "POSITION_WRITE_TOKEN_MISMATCH expected=g actual=h",
      },
    ],
  });
  assert.strictEqual(suppressedWriter.error_count_24h, 0);
  assert.strictEqual(suppressedWriter.active_error_count_24h, 0);
}

try {
  run();
  console.log("RUNTIME_ERROR_COUNTER_TEST_OK");
} catch (err) {
  console.error("RUNTIME_ERROR_COUNTER_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
