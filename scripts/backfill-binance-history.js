const { getFirestore } = require("../src/storage/firestore");
const { getExchangeSettingsForProvider } = require("../src/utils/exchangeSettings");
const { defaultExecTfFromEnv } = require("../src/utils/marketConfig");
const { syncBinanceFuturesFills } = require("../src/services/binanceFuturesFillsSync");
const { syncBinanceFuturesFundingFees } = require("../src/services/binanceFuturesFundingSync");

const DAY_MS = 24 * 60 * 60 * 1000;

function parseArgNumber(argv, names, fallback) {
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "");
    if (!names.includes(token)) continue;
    const next = Number(argv[i + 1]);
    if (Number.isFinite(next) && next > 0) return next;
  }
  return fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

async function resetSyncCursors(db, markets) {
  const refs = [];
  for (const m of markets) {
    refs.push(db.collection("processed_cursors").doc(`FILL_SYNC__BINANCEFUT__${m}`));
    refs.push(db.collection("processed_cursors").doc(`FUNDING_SYNC__BINANCEFUT__${m}`));
  }
  if (!refs.length) return { requested: 0, deleted: 0 };
  let deleted = 0;
  for (const ref of refs) {
    const snap = await ref.get();
    if (!snap.exists) continue;
    await ref.delete();
    deleted += 1;
  }
  return { requested: refs.length, deleted };
}

(async () => {
  const argv = process.argv.slice(2);
  const days = parseArgNumber(argv, ["--days", "-d"], 45);
  const includeFills = !hasFlag(argv, "--funding-only");
  const includeFunding = !hasFlag(argv, "--fills-only");
  const keepCursor = hasFlag(argv, "--keep-cursor");
  const lookbackMs = days * DAY_MS;

  const ex = await getExchangeSettingsForProvider("BINANCEFUT", 5000);
  const markets = Array.isArray(ex && ex.markets) ? ex.markets : [];
  if (!markets.length) {
    throw new Error("No BINANCEFUT markets configured.");
  }

  const out = {
    days,
    lookbackMs,
    markets_n: markets.length,
    markets,
    cursor_reset: null,
    fills_sync: null,
    funding_sync: null,
  };

  if (!keepCursor) {
    const db = getFirestore();
    out.cursor_reset = await resetSyncCursors(db, markets);
  }

  if (includeFills) {
    out.fills_sync = await syncBinanceFuturesFills({
      markets,
      execTf: ex && ex.exec_tf ? ex.exec_tf : (defaultExecTfFromEnv() || "15m"),
      executionMode: "LIVE",
      liveEnabled: true,
      lookbackMs,
      minIntervalMs: 0,
      force: true,
    });
  }

  if (includeFunding) {
    out.funding_sync = await syncBinanceFuturesFundingFees({
      markets,
      executionMode: "LIVE",
      liveEnabled: true,
      lookbackMs,
      minIntervalMs: 0,
      force: true,
    });
  }

  console.log(JSON.stringify(out, null, 2));
})().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
