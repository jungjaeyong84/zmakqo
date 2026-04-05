"use strict";

const assert = require("assert");
const { buildExecutionModelRows, summarizeExecutionModelRows, splitExecutionModelRows, __test } = require("../utils/executionModelDataset");

const intents = {
  rows: [
    {
      id: 'I1', intent_id: 'I1', signal_id: 'S1', entry_event_id: 'E1', exchange: 'BINANCEFUT', symbol: 'ETHUSDT', tf: '15m', event: 'SHORT', side: 'SELL',
      execution_mode: 'PAPER',
      created_at: '2026-04-05T00:00:00.000Z', live_exec_policy_quality_latency_ms: 1200, live_exec_policy_quality_slippage_bps: 4, live_exec_policy_quality_partial_pct: 0,
      features_json: { score_abs: 70.1, entry_grade: 'CORE' }, status: 'FILLED'
    },
    {
      id: 'I2', intent_id: 'I2', signal_id: 'S2', entry_event_id: 'E2', exchange: 'BINANCEFUT', symbol: 'SOLUSDT', tf: '15m', event: 'SHORT', side: 'SELL',
      created_at: '2026-04-05T01:00:00.000Z', terminal_failure_status: 'REJECTED', status_reason: 'MARGIN', features_json: { score_abs: 80.2, entry_grade: 'EARLY' }, status: 'FAILED'
    }
  ]
};
const fills = {
  rows: [
    { fill_id: 'F1', intent_id: 'I1', exchange: 'BINANCEFUT', symbol: 'ETHUSDT', tf: '15m', event: 'SHORT', created_at: '2026-04-05T00:00:02.000Z', exec_price: 100, slippage_bps: 3, live_exec_policy_quality_partial_pct: 25 },
    { fill_id: 'F2', intent_id: 'I1', exchange: 'BINANCEFUT', symbol: 'ETHUSDT', tf: '15m', event: 'SHORT', created_at: '2026-04-05T00:00:03.000Z', exec_price: 101, slippage_bps: 5, live_exec_policy_quality_partial_pct: 25 },
  ]
};
const webhooks = {
  rows: [
    { stage: 'INGRESS', request_id: 'WH1', created_at: '2026-04-05T01:59:30.000Z' },
    { stage: 'OUTCOME', request_id: 'WH1', created_at: '2026-04-05T01:59:40.000Z', exchange: 'BINANCEFUT', symbol: 'BNBUSDT', tf: '15m', event: 'LONG', signal_id: 'SIG__BINANCEFUT__BNBUSDT__15m__1743818340000__LONG', bar_close_time_utc_ms: Date.parse('2026-04-05T01:59:00.000Z'), decision: 'SAVED', reason: 'TV_WEBHOOK' },
  ]
};
const webhookProbes = {
  rows: [
    { request_id: 'WH1', phase: 'IMMEDIATE_PROCESS_RESULT', created_at: '2026-04-05T02:00:01.000Z', summary: { status: 'OK' } },
  ]
};

const rows = buildExecutionModelRows({ intents, fills });
assert.equal(rows.length, 2);
assert.equal(rows[0].labels.was_filled, true);
assert.equal(rows[0].labels.was_partial, true);
assert.equal(rows[0].labels.was_rejected, false);
assert.equal(rows[0].execution.created_to_fill_ms, 2000);
assert.equal(rows[0].execution.created_to_fill_source, 'FILL_DOC');
assert.equal(rows[0].execution.signal_to_intent_ms, null);
assert.equal(rows[0].execution.signal_to_fill_ms, null);
assert.equal(rows[0].labels.created_to_fill_measured, true);
assert.equal(rows[0].context.source, 'PAPER_RUNTIME');
assert.equal(rows[0].execution.slippage_bps, 4);
assert.equal(rows[1].labels.was_rejected, true);
assert.equal(rows[1].execution.no_fill_reason, 'MARGIN');
assert.equal(rows[1].execution.no_fill_detail, null);
assert.equal(rows[1].execution.no_fill_reason_family, 'RUNTIME_ERROR');
assert.equal(rows[1].execution.no_fill_subtype, 'MARGIN');
const summary = summarizeExecutionModelRows(rows);
assert.equal(summary.rows_n, 2);
assert.equal(summary.entry_rows_n, 2);
assert.equal(summary.exit_rows_n, 0);
assert.equal(summary.filled_n, 1);
assert.equal(summary.partial_n, 1);
assert.equal(summary.rejected_n, 1);
assert.equal(summary.created_to_fill_measured_p95_ms, 2000);
const noFillBucket = summary.by_primary_fill_source.find((row) => row.key === 'NO_FILL');
const unknownBucket = summary.by_primary_fill_source.find((row) => row.key === 'UNKNOWN');
assert.equal(noFillBucket.slippage_missing_n, 1);
assert.equal(unknownBucket.slippage_measured_n, 1);
assert.equal(summary.top_no_fill_reasons[0].key, 'MARGIN');
assert.equal(summary.top_no_fill_reason_families[0].key, 'RUNTIME_ERROR');
assert.equal(summary.top_no_fill_subtypes[0].key, 'MARGIN');
const split = splitExecutionModelRows(rows);
assert.equal(split.entry_rows.length, 2);
assert.equal(split.exit_rows.length, 0);

const recomputedRows = buildExecutionModelRows({
  intents: {
    rows: [
      {
        id: 'I3', intent_id: 'I3', signal_id: 'SIG__BINANCEFUT__BNBUSDT__15m__1743818340000__LONG', signal_doc_id: 'SIG__BINANCEFUT__BNBUSDT__15m__1743818340000__LONG', exchange: 'BINANCEFUT', symbol: 'BNBUSDT', tf: '15m', event: 'LONG', side: 'BUY',
        reason: 'TV_WEBHOOK',
        execution_mode: 'LIVE',
        created_at: '2026-04-05T02:00:00.000Z', signal_price: 100, signal_bar_close_time_utc_ms: Date.parse('2026-04-05T01:59:00.000Z'), status: 'FILLED', features_json: { entry_grade: 'EARLY' }
      }
    ]
  },
  fills: {
    rows: [
      { fill_id: 'F3', intent_id: 'I3', exchange: 'BINANCEFUT', symbol: 'BNBUSDT', tf: '15m', event: 'LONG', side: 'BUY', created_at: '2026-04-05T02:00:01.000Z', exec_price: 101, slippage_bps: 0 }
    ]
  },
  webhooks,
  webhookProbes,
});
const filteredRows = buildExecutionModelRows({
  intents: {
    rows: [
      {
        id: "I4", intent_id: "I4", exchange: "BINANCEFUT", symbol: "AXSUSDT", tf: "15m", event: "EMO_SHORT", side: "SELL",
        created_at: "2026-04-05T03:00:00.000Z", status: "FAILED", terminal_failure_status: "FAILED", features_json: {}
      },
      {
        id: "I5", intent_id: "I5", exchange: "BINANCEFUT", symbol: "BNBUSDT", tf: "15m", event: "LONG", side: "BUY",
        created_at: "2026-04-05T03:01:00.000Z", status: "FILLED", features_json: { entry_grade: "EARLY" }
      }
    ]
  },
  fills: { rows: [] },
});
assert.strictEqual(filteredRows.length, 1);
assert.strictEqual(filteredRows[0].context.market, "BNBUSDT");
assert.strictEqual(filteredRows[0].features.entry_grade, "EARLY");
assert.ok(recomputedRows[0].execution.slippage_bps > 0, 'signal-price fallback must recompute positive adverse slippage');
assert.strictEqual(recomputedRows[0].context.source, 'TV_WEBHOOK');
assert.strictEqual(recomputedRows[0].context.event, 'EARLY_LONG');
assert.strictEqual(recomputedRows[0].execution.signal_to_intent_ms, 60000);
assert.strictEqual(recomputedRows[0].execution.signal_to_fill_ms, 61000);
assert.strictEqual(recomputedRows[0].execution.webhook_to_intent_ms, 30000);
assert.strictEqual(recomputedRows[0].execution.webhook_to_outcome_ms, 10000);
assert.strictEqual(recomputedRows[0].execution.webhook_has_immediate_probe, true);
assert.strictEqual(recomputedRows[0].execution.webhook_immediate_phase, 'IMMEDIATE_PROCESS_RESULT');
assert.strictEqual(recomputedRows[0].execution.webhook_immediate_status, 'OK');
assert.strictEqual(recomputedRows[0].execution.entry_schedule_reason, null);
assert.strictEqual(recomputedRows[0].execution.signal_to_intent_bucket, '30S_2M');
assert.strictEqual(recomputedRows[0].features.entry_reason_profile, 'UNKNOWN|UNKNOWN|UNKNOWN');
assert.strictEqual(recomputedRows[0].features.policy_block_hint, 'NONE');
assert.strictEqual(recomputedRows[0].features.same_dir_add, false);
assert.strictEqual(recomputedRows[0].features.current_bar_fast_fill, false);
assert.strictEqual(recomputedRows[0].features.runtime_exception_without_no_fill_reason, false);
assert.strictEqual(recomputedRows[0].features.stale_pos_entry_profile, 'NOT_STALE_POS_ENTRY');
const recomputedSummary = summarizeExecutionModelRows(recomputedRows);
assert.strictEqual(recomputedSummary.signal_to_intent_p95_ms, 60000);
assert.strictEqual(recomputedSummary.signal_to_fill_p95_ms, 61000);
assert.strictEqual(recomputedSummary.top_signal_to_intent_latency_groups[0].key, 'EARLY_LONG|TV_WEBHOOK|BNBUSDT');
assert.strictEqual(recomputedSummary.top_operational_signal_to_intent_latency_groups[0].key, 'EARLY_LONG|TV_WEBHOOK|BNBUSDT');
assert.strictEqual(recomputedSummary.webhook_to_intent_p95_ms, 30000);
assert.strictEqual(recomputedSummary.top_webhook_to_intent_latency_groups[0].key, 'EARLY_LONG|TV_WEBHOOK|BNBUSDT');
assert.strictEqual(Array.isArray(recomputedSummary.top_webhook_delay_reasons), true);
assert.strictEqual(Array.isArray(recomputedSummary.top_webhook_delay_causes), true);
assert.strictEqual(Array.isArray(recomputedSummary.top_operational_webhook_delay_causes), true);
assert.strictEqual(Array.isArray(recomputedSummary.top_operational_immediate_intent_delay_groups), true);
assert.strictEqual(__test.deriveNoFillReasonFamily('DROP_EV_GATE_TP1_PROB'), 'FILTER_DROP');
assert.strictEqual(__test.deriveNoFillReasonFamily('POSITION_FULL'), 'POLICY_OR_CAPACITY');
assert.strictEqual(__test.deriveNoFillReasonFamily('INTENT_EXPIRED'), 'CONTROL_FLOW');
assert.strictEqual(__test.deriveNoFillSubtype({ reason: 'LIVE_EXCEPTION', detail: 'late_exec_from=2026-02-07T07:15:00.000Z' }), 'TIMING_LATE_EXEC');
assert.strictEqual(__test.deriveNoFillSubtype({ reason: 'LIVE_EXCEPTION', detail: 'immediate_exec=2026-02-06T14:00:00.000Z' }), 'TIMING_IMMEDIATE_EXEC');
assert.strictEqual(__test.deriveEntryScheduleReason({ pending_reason: 'WAIT_NEXT_BAR' }), 'WAIT_NEXT_BAR');
assert.strictEqual(__test.deriveSignalToIntentBucket(3000), 'LT_5S');
assert.strictEqual(__test.deriveSignalToIntentBucket(40000), '30S_2M');
assert.strictEqual(__test.deriveNormalizedProConflict({ features: { pro_conflict_short: true }, side: 'SELL', event: 'CORE_SHORT' }), true);
assert.strictEqual(__test.derivePolicyBlockHint({ noFillReason: 'TOTAL_BUDGET_EXCEEDED', noFillReasonFamily: 'POLICY_OR_CAPACITY', features: { reason: 'PINE_DROP_STALE_POS_TO_ENTRY', cost_shield_block_add: true } }), 'TOTAL_BUDGET_STALE_POS_COST_SHIELD');
assert.strictEqual(__test.deriveSameDirAddFlag({ reason: 'IN_POSITION_SAME_DIR', action: 'ADD' }), true);
assert.strictEqual(__test.deriveCurrentBarFastFillFlag({ entryScheduleProfile: 'EXEC_CURRENT_BAR', wasFilled: true, createdToFillMs: 1200 }), true);
assert.strictEqual(__test.deriveRuntimeExceptionWithoutNoFillReasonFlag({ noFillReasonFamily: 'RUNTIME_ERROR', noFillReason: null }), true);
assert.strictEqual(__test.deriveStalePosEntryProfile({ features: { reason: 'PINE_DROP_STALE_POS_TO_ENTRY' }, wasFilled: true, signalToIntentMs: 90000 }), 'STALE_POS_FILLED');
assert.strictEqual(__test.deriveStalePosEntryProfile({ features: { reason: 'PINE_DROP_STALE_POS_TO_ENTRY' }, wasFilled: true, signalToIntentMs: 180000 }), 'STALE_POS_DELAYED_INTENT_FILLED');
assert.strictEqual(__test.deriveStalePosEntryProfile({ features: { reason: 'PINE_DROP_STALE_POS_TO_ENTRY' }, wasFilled: false, noFillReason: 'TOTAL_BUDGET_EXCEEDED', signalToIntentMs: 80000 }), 'STALE_POS_BLOCKED');
assert.strictEqual(__test.deriveWebhookDelayCause({ context: { source: 'TV_WEBHOOK' }, execution: { entry_schedule_reason: 'WAIT_NEXT_BAR' } }), 'SCHEDULED_WAIT_NEXT_BAR');
assert.strictEqual(__test.deriveWebhookDelayCause({ context: { source: 'TV_WEBHOOK' }, execution: { entry_schedule_reason: 'EXEC_CURRENT_BAR', signal_bar_close_ms: 1000, scheduled_exec_bar_close_ms: 2000, signal_to_intent_ms: 420000, webhook_to_intent_ms: 430000 }, labels: { was_filled: true } }), 'IMMEDIATE_EXEC_NEXT_EXEC_BAR');
assert.strictEqual(__test.deriveWebhookDelayCause({ context: { source: 'TV_WEBHOOK' }, execution: { entry_schedule_reason: 'EXEC_CURRENT_BAR', signal_to_intent_ms: 420000, webhook_to_intent_ms: 430000, webhook_decision: 'SAVED', webhook_has_immediate_probe: false }, labels: { was_filled: true } }), 'LEGACY_WEBHOOK_OUTCOME_ONLY');
assert.strictEqual(__test.deriveWebhookDelayCause({ context: { source: 'TV_WEBHOOK' }, execution: { entry_schedule_reason: 'EXEC_CURRENT_BAR', signal_to_intent_ms: 420000, webhook_to_intent_ms: 430000, webhook_decision: 'DROP', webhook_has_immediate_probe: true }, labels: { was_filled: true } }), 'IMMEDIATE_EXEC_WEBHOOK_DROP_LATER_INTENT');
assert.strictEqual(__test.deriveWebhookDelayCause({ context: { source: 'TV_WEBHOOK' }, execution: { entry_schedule_reason: 'EXEC_CURRENT_BAR', signal_to_intent_ms: 420000, webhook_to_intent_ms: 430000, webhook_decision: 'SAVED', webhook_has_immediate_probe: true }, labels: { was_filled: true } }), 'IMMEDIATE_EXEC_WEBHOOK_SAVED_LATE_INTENT');
assert.strictEqual(__test.deriveWebhookDelayCause({ context: { source: 'PINE_WEBHOOK' }, execution: { entry_schedule_reason: 'EXEC_CURRENT_BAR', signal_to_intent_ms: 420000, webhook_to_intent_ms: 430000 }, labels: { was_filled: true } }), 'IMMEDIATE_EXEC_TRUE_INTENT_DELAY');
assert.strictEqual(__test.deriveWebhookDelayCause({ context: { source: 'PINE_WEBHOOK' }, execution: { entry_schedule_reason: 'EXEC_CURRENT_BAR', signal_to_intent_ms: 80000, webhook_to_intent_ms: 500000 }, labels: { was_filled: true } }), 'IMMEDIATE_EXEC_STALE_WEBHOOK_MATCH');
assert.strictEqual(__test.deriveWebhookDelayCause({ context: { source: 'PINE_WEBHOOK' }, execution: { entry_schedule_reason: 'EXEC_CURRENT_BAR', signal_to_intent_ms: -120000, webhook_to_intent_ms: 230000 }, labels: { was_filled: true } }), 'IMMEDIATE_EXEC_BEFORE_BAR_CLOSE');
assert.strictEqual(__test.deriveWebhookDelayCause({ context: { source: 'PINE_WEBHOOK' }, execution: { entry_schedule_reason: 'EXEC_CURRENT_BAR', signal_to_intent_ms: 80000, webhook_to_intent_ms: 120000 }, labels: { was_filled: true } }), 'IMMEDIATE_EXEC_DELAYED_INTENT_FILLED');
assert.strictEqual(__test.deriveWebhookDelayCause({ context: { source: 'PINE_WEBHOOK' }, execution: { entry_schedule_reason: 'EXEC_CURRENT_BAR', no_fill_reason: 'BINANCEFUT_KEYS_MISSING' } }), 'IMMEDIATE_EXEC_KEYS_MISSING');
assert.strictEqual(__test.deriveWebhookDelayCause({ context: { source: 'PINE_WEBHOOK' }, execution: { entry_schedule_reason: 'LATE_EXEC', no_fill_reason: 'INTENT_EXPIRED' } }), 'LATE_EXEC_EXPIRED');
assert.strictEqual(__test.isOperationalSource('MANUAL_REPLAY'), false);
assert.strictEqual(__test.isOperationalSource('LIVE_RUNTIME'), true);
assert.strictEqual(__test.isOperationalSource('TV_WEBHOOK'), true);
const webhookIndex = __test.buildWebhookOutcomeIndex(webhooks);
const ingressIndex = __test.buildWebhookIngressIndex(webhooks);
const webhookMatch = __test.resolveWebhookMatch({
  intent: { exchange: 'BINANCEFUT', symbol: 'BNBUSDT', tf: '15m', event: 'LONG', signal_doc_id: 'SIG__BINANCEFUT__BNBUSDT__15m__1743818340000__LONG', signal_bar_close_time_utc_ms: Date.parse('2026-04-05T01:59:00.000Z') },
  webhookOutcomes: webhookIndex,
  webhookIngressByRequestId: ingressIndex,
  webhookProbeByRequestId: __test.buildWebhookProbeIndex(webhookProbes),
});
assert.strictEqual(webhookMatch.webhook_request_id, 'WH1');
assert.strictEqual(webhookMatch.webhook_has_immediate_probe, true);
console.log('EXECUTION_MODEL_DATASET_TEST_OK');
