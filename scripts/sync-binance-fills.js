const { syncBinanceFuturesFills } = require("../src/services/binanceFuturesFillsSync");
const { getExchangeSettingsForProvider } = require("../src/utils/exchangeSettings");
const { defaultExecTfFromEnv } = require("../src/utils/marketConfig");

function parseHours(argv) {
  const idx = argv.findIndex((v) => v === "--hours" || v === "-h");
  if (idx >= 0 && argv[idx + 1]) {
    const n = Number(argv[idx + 1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

(async () => {
  const hours = parseHours(process.argv) || 72;
  const lookbackMs = hours * 60 * 60 * 1000;
  const ex = await getExchangeSettingsForProvider("BINANCEFUT", 5000);
  const markets = Array.isArray(ex && ex.markets) ? ex.markets : [];

  const res = await syncBinanceFuturesFills({
    markets,
    execTf: ex && ex.exec_tf ? ex.exec_tf : (defaultExecTfFromEnv() || "15m"),
    executionMode: "LIVE",
    liveEnabled: true,
    lookbackMs,
    force: true,
  });
  console.log(JSON.stringify(res, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
