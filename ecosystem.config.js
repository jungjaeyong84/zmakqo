require("dotenv").config({ path: require("path").join(__dirname, ".env") });

module.exports = {
  apps: [
    {
      name: "donbeolja",
      cwd: "/Users/jeongjaeyong/Projects/donbeolja",
      script: "server.js",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        BASE_URL: "http://localhost:3000",

        RUNTIME_MODE: "local",
        ENGINE_VERSION: "6.0.3.0",
        DONBEOLJA_STRATEGY_ID: "donbeolja_v6.0.3.0",
        WEBHOOK_ALLOWED_STRATEGY_IDS: "donbeolja_v6.0.3.0,donbeolja_v6.0.2.2,donbeolja_v6.0.2.1,donbeolja_v6.0.2.0,donbeolja_v6.0.1.2,donbeolja_v6.0.0.0,donbeolja_v5.6.0.7,donbeolja_v5.6.0.6,donbeolja_v5.6.0.4,donbeolja_v5.6.0.3,STRAT_v010,STRAT_v002,donbeolja_v5.6.0.2,donbeolja_v5.5.9.1,donbeolja_v5.5.9.0,donbeolja_v5.5.8.0,donbeolja_v5.5.6.0,donbeolja_v5.5.5.9",

        // 스케줄
        SCHEDULE_POLL_MS: 10000,
        SCHEDULER_TOKEN: process.env.SCHEDULER_TOKEN || "",
        SCHEDULER_AUTOSTART: "1",
        AUTO_WEEKLY_CLOSE: "1",
        ALLOW_REPLAY_SAME_BAR: "1",
        SIGNALS_LOOKBACK_BARS: "24",
        SIGNALS_LATE_MAX_AGE_MS: "86400000",
        EXIT_IMMEDIATE_ENABLED: "1",
        TP_P1_DEBUG: "1",
        SIGNAL_AI_CAN_BLOCK: "1",
        SIGNAL_AI_FAIL_MODE: "REDUCE",
        SIGNAL_AI_MISSING_REDUCE_PCT: process.env.SIGNAL_AI_MISSING_REDUCE_PCT || "0.5",
        SIGNAL_AI_MODEL: "claude-sonnet-4-6-20260514",
        SIGNAL_AI_TIMEOUT_MS: 8000,
        SIGNAL_AI_RETRY_MAX: 2,
        SIGNAL_AI_RETRY_BASE_MS: 250,
        SIGNAL_AI_CORR_TF: "15m",
        SIGNAL_LIFECYCLE_ALERT_CHANNEL:
          process.env.SIGNAL_LIFECYCLE_ALERT_CHANNEL
          || process.env.EXIT_INTEGRITY_ALERT_CHANNEL
          || (process.env.TELEGRAM_CHAT_ID ? `telegram:${process.env.TELEGRAM_CHAT_ID}` : ""),
        COMMISSION_GATE_ENABLED: process.env.COMMISSION_GATE_ENABLED || "0",
        COMMISSION_GATE_ENFORCE: process.env.COMMISSION_GATE_ENFORCE || "0",
        COMMISSION_RATIO_THRESHOLD: process.env.COMMISSION_RATIO_THRESHOLD || "0.25",
        EXIT_INTEGRITY_ALERT_CHANNEL:
          process.env.EXIT_INTEGRITY_ALERT_CHANNEL
          || (process.env.TELEGRAM_CHAT_ID ? `telegram:${process.env.TELEGRAM_CHAT_ID}` : ""),
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || "",

        // 세션
        SESSION_COOKIE_SECURE: "false",
        SESSION_SECRET: process.env.SESSION_SECRET || "",
        ALLOWLIST_EMAIL: "jungjaeyong@gmail.com",
        GOOGLE_APPLICATION_CREDENTIALS: "",

        // 비용 가정
        FEE_BPS: 5,
        SLIPPAGE_BPS: 10,
        MAX_LAG_MS: 930000,

        // PAPER 규칙/금액
        PAPER_RULES: "R1_BASE,R2_STRICT",
        PAPER_MAX_KRW: 100000,

        // 멀티 거래소 실행 (Firestore 설정 사용)
        BINANCEFUT_MARKETS: "BTCUSDT,ETHUSDT,XRPUSDT,SOLUSDT,AVAXUSDT,BNBUSDT,DOGEUSDT,LTCUSDT,LINKUSDT,ADAUSDT,SUIUSDT",
        EXCHANGE_PROVIDERS: "BINANCEFUT",
        EXCHANGE_TF_ALLOWLIST: "15m",
        EXCHANGE_EXEC_TF: "15m",
        GOOGLE_APPLICATION_CREDENTIALS: "",

        // Binance tick exit (로컬은 대시보드 전용, Cloud Run exit-worker에 위임)
        TICK_EXIT_ENABLED: "0",
        TICK_EXIT_FASTLANE_ENABLED: "1",
        TICK_EXIT_FASTLANE_INTERVAL_MS: "1000",
        TICK_EXIT_FASTLANE_PCT: "0.003",
        BINANCE_NATIVE_PROTECTION_ENABLED: "1",
        BINANCE_NATIVE_TP_ENABLED: "1",

        // ✅ TradingView Webhook token (핵심)
        TV_WEBHOOK_TOKEN: process.env.TV_WEBHOOK_TOKEN || process.env.WEBHOOK_TOKEN || "",
        WEBHOOK_TOKEN: process.env.WEBHOOK_TOKEN || process.env.TV_WEBHOOK_TOKEN || "",
      },
    },
  ],
};
