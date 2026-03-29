const CHARTER_EXPECTATIONS = {
  signal_engine: {
    default: {
      SL: -0.015,
      TP_P1: 0.03,
      TP_P1_QTY: 0.3,
      TP_C: null,
      BE_PCT: null,
      TRAIL_PCT: 0.015,
    },
    by_exchange: {
      UPBIT: {
        SL: -0.015,
        TP_P1: 0.03,
        TP_P1_QTY: 0.3,
        TP_C: null,
        BE_PCT: null,
        TRAIL_PCT: 0.015,
      },
      BINANCEFUT: {
        SL: -0.0165,
        TP_P1: 0.0325,
        TP_P1_QTY: 0.5,
        TP_C: null,
        BE_PCT: 0.0025,
        TRAIL_PCT: 0.01,
      },
      KIWOOM: {
        SL: -0.03,
        TP_P1: 0.05,
        TP_P1_QTY: 0.5,
        TP_C: null,
        BE_PCT: null,
        TRAIL_PCT: 0.03,
      },
    },
  },
  mapping: {
    SIGNAL_MAPPING_VERSION: "v1",
  },
};

module.exports = { CHARTER_EXPECTATIONS };
