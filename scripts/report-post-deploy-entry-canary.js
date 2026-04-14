#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");
const { evaluateEntryBudgetGuard } = require("../src/utils/entryBudgetGuard");

const ROOT = path.resolve(__dirname, "..");
const OPS_DAILY_DIR = path.join(ROOT, "ops", "daily");
const DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "AXSUSDT"];
const CHECK_QTY_PCTS = [1, 0.65, 0.5, 0.2];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function parseArgs(argv = []) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "");
    if (token === "--since") out.since = argv[i + 1];
    if (token === "--minutes") out.minutes = argv[i + 1];
    if (token === "--symbols") out.symbols = argv[i + 1];
  }
  return out;
}

function toIsoMinuteKey(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}${mi}`;
}

function readSymbols(raw) {
  const text = String(raw || process.env.BINANCEFUT_MARKETS || "").trim();
  if (!text) return DEFAULT_SYMBOLS.slice();
  return text.split(",").map((item) => String(item || "").trim().toUpperCase()).filter(Boolean);
}

function parseSince(raw, minutesRaw) {
  if (raw) {
    const ts = Date.parse(String(raw));
    if (Number.isFinite(ts)) return new Date(ts).toISOString();
  }
  const minutes = Number(minutesRaw);
  const lookbackMinutes = Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 60;
  return new Date(Date.now() - lookbackMinutes * 60 * 1000).toISOString();
}

function summarizeTop(rows, field, limit = 10) {
  const map = new Map();
  for (const row of rows) {
    const key = String(row && row[field] ? row[field] : "UNKNOWN");
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

async function fetchRecentDropsAndIntents(db, sinceIso) {
  const [dropSnap, intentSnap] = await Promise.all([
    db.collection("signals_dropped").where("created_at", ">=", sinceIso).orderBy("created_at", "desc").limit(200).get(),
    db.collection("order_intents_paper").where("created_at", ">=", sinceIso).orderBy("created_at", "desc").limit(200).get(),
  ]);
  const drops = [];
  const intents = [];
  dropSnap.forEach((doc) => {
    const data = doc.data() || {};
    drops.push({
      id: doc.id,
      created_at: data.created_at || null,
      symbol: data.symbol || data.symbol_or_pair_id || null,
      reason: data.reason || null,
    });
  });
  intentSnap.forEach((doc) => {
    const data = doc.data() || {};
    intents.push({
      id: doc.id,
      created_at: data.created_at || null,
      symbol: data.symbol || data.symbol_or_pair_id || null,
      status: data.status || null,
      cancel_reason: data.cancel_reason || data.status_reason || null,
    });
  });
  return { drops, intents };
}

async function buildSymbolAssessments(symbols) {
  const rows = [];
  for (const symbol of symbols) {
    const checks = [];
    for (const qtyPct of CHECK_QTY_PCTS) {
      const result = await evaluateEntryBudgetGuard({
        exchange: "BINANCEFUT",
        symbol,
        intent: "ENTRY",
        qtyPct,
      });
      checks.push({
        qty_pct: qtyPct,
        ok: result.ok,
        reason: result.reason,
        budget_max: result.budgetMax,
        leverage: result.leverage,
        min_required_quote: result.minRequiredQuote,
        notional_quote: result.notionalQuote,
        shortfall_quote: result.shortfallQuote,
      });
    }
    const full = checks.find((row) => row.qty_pct === 1) || null;
    const half = checks.find((row) => row.qty_pct === 0.5) || null;
    let verdict = "UNKNOWN";
    if (full && full.ok !== true) verdict = "STRUCTURALLY_INFEASIBLE";
    else if (half && half.ok !== true) verdict = "FULL_ONLY";
    else if (checks.some((row) => row.qty_pct < 1 && row.ok === true)) verdict = "REDUCED_FEASIBLE";
    else if (full && full.ok === true) verdict = "FULL_FEASIBLE";
    rows.push({
      symbol,
      verdict,
      checks,
    });
  }
  return rows;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Post-Deploy Entry Canary");
  lines.push("");
  lines.push(`- generated_at: ${report.generated_at}`);
  lines.push(`- since: ${report.since}`);
  lines.push(`- recent_drops: ${report.recent.drops.count}`);
  lines.push(`- recent_intents: ${report.recent.intents.count}`);
  lines.push("");
  lines.push("## Recent Drops");
  if (!report.recent.drops.top_reasons.length) lines.push("- none");
  for (const row of report.recent.drops.top_reasons) {
    lines.push(`- ${row.name}: ${row.count}`);
  }
  lines.push("");
  lines.push("## Recent Intents");
  if (!report.recent.intents.top_status.length) lines.push("- none");
  for (const row of report.recent.intents.top_status) {
    lines.push(`- ${row.name}: ${row.count}`);
  }
  lines.push("");
  lines.push("## Symbol Feasibility");
  for (const symbolRow of report.symbols) {
    lines.push(`- ${symbolRow.symbol}: ${symbolRow.verdict}`);
    for (const check of symbolRow.checks) {
      lines.push(`  - qty=${check.qty_pct}: ${check.ok ? "PASS" : "BLOCK"} / reason=${check.reason} / notional=${check.notional_quote} / min_required=${check.min_required_quote}`);
    }
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const since = parseSince(args.since, args.minutes);
  const symbols = readSymbols(args.symbols);
  const db = getFirestore();
  const recent = await fetchRecentDropsAndIntents(db, since);
  const symbolRows = await buildSymbolAssessments(symbols);
  const report = {
    generated_at: new Date().toISOString(),
    since,
    recent: {
      drops: {
        count: recent.drops.length,
        top_reasons: summarizeTop(recent.drops, "reason"),
        rows: recent.drops,
      },
      intents: {
        count: recent.intents.length,
        top_status: summarizeTop(recent.intents, "status"),
        top_cancel_reasons: summarizeTop(recent.intents, "cancel_reason"),
        rows: recent.intents,
      },
    },
    symbols: symbolRows,
  };

  ensureDir(OPS_DAILY_DIR);
  const base = `${toIsoMinuteKey(new Date())}_post_deploy_entry_canary`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "post_deploy_entry_canary_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "post_deploy_entry_canary_latest.md");
  const markdown = renderMarkdown(report);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath, markdown);
  fs.writeFileSync(latestJsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(latestMdPath, markdown);
  console.log(JSON.stringify({
    ok: true,
    report_json: jsonPath,
    report_md: mdPath,
    latest_json: latestJsonPath,
    latest_md: latestMdPath,
    drop_count: report.recent.drops.count,
    intent_count: report.recent.intents.count,
    structurally_infeasible_symbols: report.symbols.filter((row) => row.verdict === "STRUCTURALLY_INFEASIBLE").map((row) => row.symbol),
  }, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
