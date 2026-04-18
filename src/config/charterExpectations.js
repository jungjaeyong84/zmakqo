const CHARTER_EXPECTATIONS = {
  signal_engine: {
    default: {
      SL: -0.0165,
      TP_P0: 0.008,
      TP_P0_QTY: 0.25,
      TP_P0_ATR_MULTIPLE: 0.8,
      TP_P1: 0.0325,
      TP_P1_RESCUE_COHORT: 0.0165,
      TP_P1_MIXED_COHORT: 0.025,
      TP_P1_QTY: 0.5,
      TP_C: null,
      BE_PCT_RESCUE_COHORT: 0.0015,
      BE_PCT_MIXED_COHORT: 0.002,
      TRAIL_R_MULTIPLE_RESCUE_COHORT: 0.6,
      TRAIL_R_MULTIPLE_MIXED_COHORT: 0.75,
      BE_PCT: 0.0025,
      // Runner floor that kicks in the moment TP1 fills (before trailing
      // fully arms). 0.003 = 0.3% above entry — just enough to cover the
      // round-trip fee+slippage budget so the worst case after a TP1 fill
      // is "scratch" instead of a SL hit. Before this default was added
      // the field was undefined and computeRunnerMinProfitStopPrice
      // always returned null → the leftover 75% runner had no floor and
      // was dragged to the original SL in the TP1→trail gap, which
      // showed up in the data as "TP1 1.65% 실제 평균 +0.7%" (table
      // in the 2026-04-18 exit param audit).
      RUNNER_MIN_PROFIT_PCT: 0.003,
      RUNNER_MIN_PROFIT_PCT_RESCUE_COHORT: 0.0165,
      RUNNER_MIN_PROFIT_PCT_MIXED_COHORT: 0.0165,
      PRE_TP1_TIME_STOP_BARS_EARLY: 4,
      PRE_TP1_TIME_STOP_BARS_CORE: 6,
      PRE_TP1_TIME_STOP_PROGRESS_FRACTION: 0.5,
      TRAIL_DELAY_BARS: 1,
      TRAIL_DELAY_MFE_PCT: 0.005,
      TRAIL_R_MULTIPLE: 0.9,
      TRAIL_PCT: 0.01,
    },
    by_exchange: {
      BINANCEFUT: {
        SL: -0.0165,
        TP_P0: 0.008,
        TP_P0_QTY: 0.25,
        TP_P0_ATR_MULTIPLE: 0.8,
        TP_P1: 0.0325,
        TP_P1_RESCUE_COHORT: 0.0165,
        TP_P1_MIXED_COHORT: 0.025,
        TP_P1_QTY: 0.5,
        TP_C: null,
        BE_PCT_RESCUE_COHORT: 0.0015,
        BE_PCT_MIXED_COHORT: 0.002,
        TRAIL_R_MULTIPLE_RESCUE_COHORT: 0.6,
        TRAIL_R_MULTIPLE_MIXED_COHORT: 0.75,
        BE_PCT: 0.0025,
        RUNNER_MIN_PROFIT_PCT: 0.003,
        RUNNER_MIN_PROFIT_PCT_RESCUE_COHORT: 0.0165,
        RUNNER_MIN_PROFIT_PCT_MIXED_COHORT: 0.0165,
        PRE_TP1_TIME_STOP_BARS_EARLY: 4,
        PRE_TP1_TIME_STOP_BARS_CORE: 6,
        PRE_TP1_TIME_STOP_PROGRESS_FRACTION: 0.5,
        TRAIL_DELAY_BARS: 1,
        TRAIL_DELAY_MFE_PCT: 0.005,
        TRAIL_R_MULTIPLE: 0.9,
        TRAIL_PCT: 0.01,
      },
    },
  },
  mapping: {
    SIGNAL_MAPPING_VERSION: "v1",
  },
};

module.exports = { CHARTER_EXPECTATIONS };
