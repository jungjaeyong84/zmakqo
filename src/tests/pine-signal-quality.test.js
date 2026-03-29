const assert = require("assert");
const { buildTradesFromFills } = require("../services/tradesFromFills");
const { summarizePineSignalQuality } = require("../services/pineSignalQuality");

async function run() {
  const fills = [
    {
      exchange: "UPBIT",
      symbol: "KRW-BTC",
      tf: "60m",
      side: "BUY",
      event: "CORE_LONG",
      exec_price: 100,
      qty_pct: 0.15,
      exec_bar_close_time_utc_ms: 1000,
      signal_bar_close_time_utc_ms: 1000,
      entry_event_id: "ENTRY__UPBIT__KRW-BTC__60m__1000__CORE_LONG",
      entry_signal_type: "CORE_LONG",
    },
    {
      exchange: "UPBIT",
      symbol: "KRW-BTC",
      tf: "60m",
      side: "SELL",
      event: "EXIT_TP_P1_3P",
      exec_price: 103,
      qty_pct: 0.075,
      exec_bar_close_time_utc_ms: 2000,
      signal_bar_close_time_utc_ms: 1000,
      entry_event_id: "ENTRY__UPBIT__KRW-BTC__60m__1000__CORE_LONG",
      entry_signal_type: "CORE_LONG",
    },
    {
      exchange: "UPBIT",
      symbol: "KRW-BTC",
      tf: "60m",
      side: "SELL",
      event: "EXIT_TRAIL_1P",
      exec_price: 102,
      qty_pct: 0.075,
      exec_bar_close_time_utc_ms: 3000,
      signal_bar_close_time_utc_ms: 1000,
      entry_event_id: "ENTRY__UPBIT__KRW-BTC__60m__1000__CORE_LONG",
      entry_signal_type: "CORE_LONG",
    },
    {
      exchange: "UPBIT",
      symbol: "KRW-ETH",
      tf: "60m",
      side: "BUY",
      event: "EARLY_LONG",
      exec_price: 200,
      qty_pct: 0.08,
      exec_bar_close_time_utc_ms: 4000,
      signal_bar_close_time_utc_ms: 4000,
      entry_event_id: "ENTRY__UPBIT__KRW-ETH__60m__4000__EARLY_LONG",
      entry_signal_type: "EARLY_LONG",
    },
    {
      exchange: "UPBIT",
      symbol: "KRW-ETH",
      tf: "60m",
      side: "SELL",
      event: "EXIT_SL_1.5P",
      exec_price: 197,
      qty_pct: 0.08,
      exec_bar_close_time_utc_ms: 5000,
      signal_bar_close_time_utc_ms: 4000,
      entry_event_id: "ENTRY__UPBIT__KRW-ETH__60m__4000__EARLY_LONG",
      entry_signal_type: "EARLY_LONG",
    },
  ];

  const built = buildTradesFromFills(fills, { mode: "EACH_SELL" });
  assert.ok(Array.isArray(built.trades) && built.trades.length >= 2, "trade rows should exist");
  assert.strictEqual(built.trades[0].entry_event_id, "ENTRY__UPBIT__KRW-BTC__60m__1000__CORE_LONG");
  assert.strictEqual(built.trades[0].entry_signal_type, "CORE_LONG");
  assert.strictEqual(built.trades[0].exit_event, "EXIT_TP_P1_3P");

  const signals = [
    {
      exchange: "UPBIT",
      symbol: "KRW-BTC",
      tf: "60m",
      event: "CORE_LONG",
      side: "BUY",
      bar_close_time_utc_ms: 1000,
      features_json: {
        sp_entropy_score: 0.32,
        sp_coherence_score: 0.74,
        sp_transition_risk: 0.28,
        sp_field_alignment: 0.76,
        sp_domain_wall_density: 0.21,
        sp_susceptibility: 0.26,
        sp_free_energy: 0.29,
        sp_state: "ORDERED",
        market_state_summary_state: "ORDERED",
        market_state_summary_action: "ALLOW",
        wait_one_bar_market_state_action: "ALLOW",
        wait_one_bar_action: "ALLOW",
        wait_one_bar_trigger_path: "BASE",
        _entry_exec_timing: "IMMEDIATE",
        ev_gate_policy_version: "TP1_WEIGHT_V1",
        ev_gate_policy_source: "DEFAULT",
        febt_mode: "SHADOW",
        febt_phase: "FIRE",
        febt_calc_ok: true,
        febt_calc_reason: "OK",
        febt_timing_action: "OBSERVE",
        febt_authority: "SHADOW_ONLY",
        febt_lock_score: 0.74,
        febt_delay_cost: 0.66,
        febt_late_risk: 0.29,
        febt_failure_risk: 0.18,
        febt_edge: 0.37,
      },
    },
    {
      exchange: "UPBIT",
      symbol: "KRW-ETH",
      tf: "60m",
      event: "EARLY_LONG",
      side: "BUY",
      bar_close_time_utc_ms: 4000,
      features_json: {
        sp_entropy_score: 0.71,
        sp_coherence_score: 0.33,
        sp_transition_risk: 0.79,
        sp_field_alignment: 0.38,
        sp_domain_wall_density: 0.57,
        sp_susceptibility: 0.69,
        sp_free_energy: 0.73,
        sp_state: "DISORDERED",
      },
    },
  ];

  const summary = await summarizePineSignalQuality({
    signals,
    fills,
    exchange: "UPBIT",
    tf: "60m",
    fromMs: 0,
    toMs: 10000,
  });

  assert.strictEqual(summary.by_tier.CORE.signals_n, 1);
  assert.strictEqual(summary.by_tier.CORE.executed_n, 1);
  assert.strictEqual(summary.by_tier.CORE.tp1_hit_n, 1);
  assert.strictEqual(summary.by_tier.CORE.trail_after_tp1_n, 1);
  assert.strictEqual(summary.by_tier.CORE.realized_chains_n, 1);
  assert.strictEqual(summary.by_tier.CORE.win_n, 1);
  assert.strictEqual(summary.chain_rows[0].side, "LONG");
  assert.strictEqual(summary.chain_rows[0].regime, "unknown");
  assert.strictEqual(summary.chain_rows[0].score_bucket, "unknown");
  assert.strictEqual(summary.chain_rows[0].conf_bucket, "unknown");
  assert.strictEqual(summary.chain_rows[0].wave_bucket, "unknown");
  assert.strictEqual(summary.chain_rows[0].session_bucket, "asia");
  assert.strictEqual(summary.chain_rows[0].entropy_bucket, "<0.35");
  assert.strictEqual(summary.chain_rows[0].coherence_bucket, "0.65+");
  assert.strictEqual(summary.chain_rows[0].transition_bucket, "<0.30");
  assert.strictEqual(summary.chain_rows[0].field_alignment_bucket, "0.65+");
  assert.strictEqual(summary.chain_rows[0].domain_wall_bucket, "<0.25");
  assert.strictEqual(summary.chain_rows[0].free_energy_bucket, "<0.35");
  assert.strictEqual(summary.chain_rows[0].stat_phys_state, "ORDERED");
  assert.strictEqual(summary.chain_rows[0].market_state_summary_state, "ORDERED");
  assert.strictEqual(summary.chain_rows[0].market_state_summary_action, "ALLOW");
  assert.strictEqual(summary.chain_rows[0].wait_one_bar_market_state_action, "ALLOW");
  assert.strictEqual(summary.chain_rows[0].legacy_wait_action, "ALLOW");
  assert.strictEqual(summary.chain_rows[0].legacy_wait_trigger_path, "BASE");
  assert.strictEqual(summary.chain_rows[0].entry_exec_timing, "IMMEDIATE");
  assert.strictEqual(summary.chain_rows[0].ev_gate_policy_version, "TP1_WEIGHT_V1");
  assert.strictEqual(summary.chain_rows[0].ev_gate_policy_source, "DEFAULT");
  assert.strictEqual(summary.chain_rows[0].febt_mode, "SHADOW");
  assert.strictEqual(summary.chain_rows[0].febt_phase, "FIRE");
  assert.strictEqual(summary.chain_rows[0].febt_calc_ok, true);
  assert.strictEqual(summary.chain_rows[0].febt_calc_reason, "OK");
  assert.strictEqual(summary.chain_rows[0].febt_timing_action, "OBSERVE");
  assert.strictEqual(summary.chain_rows[0].febt_authority, "SHADOW_ONLY");
  assert.strictEqual(summary.chain_rows[0].febt_lock_score, 0.74);
  assert.strictEqual(summary.chain_rows[0].febt_edge, 0.37);
  assert.strictEqual(summary.chain_rows[0].febt_payload_missing, false);
  assert.strictEqual(summary.chain_rows[0].entry_price, 100);
  assert.strictEqual(summary.chain_rows[0].tp1_ms, 2000);
  assert.strictEqual(summary.chain_rows[0].first_exit_ms, 2000);
  assert.strictEqual(summary.by_tier.CORE.avg_entropy_score, 0.32);
  assert.strictEqual(summary.by_tier.CORE.avg_coherence_score, 0.74);
  assert.strictEqual(summary.by_tier.CORE.avg_transition_risk, 0.28);
  assert.strictEqual(summary.by_tier.CORE.avg_field_alignment, 0.76);
  assert.strictEqual(summary.by_tier.CORE.avg_domain_wall_density, 0.21);
  assert.strictEqual(summary.by_tier.CORE.avg_susceptibility, 0.26);
  assert.strictEqual(summary.by_tier.CORE.avg_free_energy, 0.29);
  assert.strictEqual(summary.by_tier.CORE.febt_calc_ok_n, 1);
  assert.strictEqual(summary.by_tier.CORE.febt_fire_n, 1);
  assert.strictEqual(summary.by_tier.CORE.febt_payload_missing_n, 0);
  assert.strictEqual(summary.by_tier.CORE.avg_febt_lock_score, 0.74);
  assert.strictEqual(summary.by_tier.CORE.avg_febt_edge, 0.37);

  assert.strictEqual(summary.by_tier.EARLY.signals_n, 1);
  assert.strictEqual(summary.by_tier.EARLY.executed_n, 1);
  assert.strictEqual(summary.by_tier.EARLY.sl_before_tp1_n, 1);
  assert.strictEqual(summary.by_tier.EARLY.realized_chains_n, 1);
  assert.strictEqual(summary.by_tier.EARLY.win_n, 0);
  assert.strictEqual(summary.by_tier.EARLY.avg_entropy_score, 0.71);
  assert.strictEqual(summary.by_tier.EARLY.avg_coherence_score, 0.33);
  assert.strictEqual(summary.by_tier.EARLY.avg_transition_risk, 0.79);
  assert.strictEqual(summary.by_tier.EARLY.avg_field_alignment, 0.38);
  assert.strictEqual(summary.by_tier.EARLY.avg_domain_wall_density, 0.57);
  assert.strictEqual(summary.by_tier.EARLY.avg_susceptibility, 0.69);
  assert.strictEqual(summary.by_tier.EARLY.avg_free_energy, 0.73);
  assert.strictEqual(summary.by_tier.EARLY.febt_payload_missing_n, 1);

  const outOfOrderFills = [
    {
      exchange: "BINANCEFUT",
      symbol: "SOLUSDT",
      tf: "15m",
      side: "SELL",
      event: "EXIT_TP_P1_3.25P",
      exec_price: 103,
      qty_pct: 0.075,
      exec_bar_close_time_utc_ms: 7000,
      signal_bar_close_time_utc_ms: null,
      entry_event_id: "ENTRY__BINANCEFUT__SOLUSDT__15m__5000__CORE_LONG",
      entry_signal_type: "CORE_LONG",
    },
    {
      exchange: "BINANCEFUT",
      symbol: "SOLUSDT",
      tf: "15m",
      side: "BUY",
      event: "CORE_LONG",
      exec_price: 100,
      qty_pct: 0.15,
      exec_bar_close_time_utc_ms: 5000,
      signal_bar_close_time_utc_ms: null,
      entry_event_id: "ENTRY__BINANCEFUT__SOLUSDT__15m__5000__CORE_LONG",
      entry_signal_type: "CORE_LONG",
    },
  ];

  const outOfOrderSummary = await summarizePineSignalQuality({
    signals: [
      {
        exchange: "BINANCEFUT",
        symbol: "SOLUSDT",
        tf: "15m",
        event: "CORE_LONG",
        side: "BUY",
        bar_close_time_utc_ms: 5000,
      },
    ],
    fills: outOfOrderFills,
    exchange: "BINANCEFUT",
    tf: "15m",
    fromMs: 0,
    toMs: 10000,
  });

  assert.strictEqual(outOfOrderSummary.meta.chains_n, 1);
  assert.strictEqual(outOfOrderSummary.chain_rows[0].entry_bar_ms, 5000);
  assert.strictEqual(outOfOrderSummary.by_tier.CORE.executed_n, 1);
  assert.strictEqual(outOfOrderSummary.chain_rows[0].entry_price, 100);

  console.log("PINE_SIGNAL_QUALITY_TEST_OK");
}

run().catch((err) => {
  console.error("PINE_SIGNAL_QUALITY_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
