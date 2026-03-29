#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { kstDateKey, toKstString } = require("../src/utils/timeKst");

function readArg(name, fallback = "") {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return fallback;
  const next = process.argv[idx + 1];
  if (!next || String(next).startsWith("--")) return fallback;
  return String(next);
}

function addKstDays(dateOnly, days) {
  const ms = Date.parse(`${dateOnly}T00:00:00+09:00`);
  if (!Number.isFinite(ms)) throw new Error(`INVALID_DATE:${dateOnly}`);
  const next = new Date(ms + (days * 24 * 60 * 60 * 1000));
  return kstDateKey(next.toISOString());
}

function parseLastJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  for (let i = raw.length - 1; i >= 0; i -= 1) {
    if (raw[i] !== "{") continue;
    const candidate = raw.slice(i);
    try {
      return JSON.parse(candidate);
    } catch (_) {
      // keep scanning
    }
  }
  return null;
}

function runNode(repoRoot, args) {
  const res = spawnSync("node", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  return {
    ok: res.status === 0,
    exit_code: res.status,
    stdout: String(res.stdout || ""),
    stderr: String(res.stderr || ""),
  };
}

function pickNextCycle(dailyDir, regex) {
  const names = fs.existsSync(dailyDir) ? fs.readdirSync(dailyDir) : [];
  let best = 0;
  for (const name of names) {
    const m = String(name).match(regex);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > best) best = n;
  }
  return best + 1;
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const dailyDir = path.join(repoRoot, "ops", "daily");
  const nowIso = new Date().toISOString();
  const generatedAtKst = toKstString(nowIso, { fallbackToString: true });
  const dateKey = readArg("date", kstDateKey(nowIso) || "unknown-date");
  const exchange = readArg("exchange", "BINANCEFUT").toUpperCase();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error(`INVALID_DATE_FORMAT:${dateKey}`);
  }

  const signalCycle = pickNextCycle(
    dailyDir,
    new RegExp(`^${dateKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_tp1_trailing_signals_check_cycle(\\d+)\\.json$`)
  );
  const auditCycle = pickNextCycle(
    dailyDir,
    new RegExp(`^${dateKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_fill_signal_audit_cycle(\\d+)_${exchange.toLowerCase()}\\.json$`)
  );
  const cycle = Math.max(signalCycle, auditCycle);

  const signalFile = path.join(dailyDir, `${dateKey}_tp1_trailing_signals_check_cycle${cycle}.json`);
  const auditFile = path.join(dailyDir, `${dateKey}_fill_signal_audit_cycle${cycle}_${exchange.toLowerCase()}.json`);
  const from = `${dateKey}T00:00:00+09:00`;
  const to = `${addKstDays(dateKey, 1)}T00:00:00+09:00`;

  const signalRun = runNode(repoRoot, ["scripts/inspect-binance-webhook-day.js", dateKey]);
  if (!signalRun.ok) {
    throw new Error(`SIGNAL_CHECK_FAIL:exit=${signalRun.exit_code}:stderr=${signalRun.stderr.trim() || "none"}`);
  }
  const signalJson = parseLastJsonObject(signalRun.stdout);
  if (!signalJson || signalJson.ok === false) {
    throw new Error("SIGNAL_CHECK_PARSE_FAIL");
  }
  writeJson(signalFile, signalJson);

  const auditRun = runNode(repoRoot, [
    "ops/audit_fills_signals.js",
    "--from", from,
    "--to", to,
    "--exchange", exchange,
    "--limit", "500",
  ]);
  if (!auditRun.ok) {
    throw new Error(`AUDIT_CHECK_FAIL:exit=${auditRun.exit_code}:stderr=${auditRun.stderr.trim() || "none"}`);
  }
  const auditJson = parseLastJsonObject(auditRun.stdout);
  if (!auditJson || auditJson.ok === false) {
    throw new Error("AUDIT_CHECK_PARSE_FAIL");
  }
  writeJson(auditFile, auditJson);

  const latest = {
    generated_at_iso: nowIso,
    generated_at_kst: generatedAtKst,
    date_key: dateKey,
    cycle,
    exchange,
    signal_file: signalFile,
    audit_file: auditFile,
    signal_summary: {
      signals: Number.isFinite(Number(signalJson.signals)) ? Number(signalJson.signals) : null,
      drops: Number.isFinite(Number(signalJson.drops)) ? Number(signalJson.drops) : null,
      drop_tp1_pending_count: Array.isArray(signalJson.drop_reasons)
        ? (signalJson.drop_reasons.find((row) => Array.isArray(row) && String(row[0]) === "DROP_TP_P1_PENDING") || [null, null])[1]
        : null,
    },
    audit_summary: auditJson.summary || {},
  };

  const latestPath = path.join(dailyDir, "execution_flow_cycle_refresh_latest.json");
  writeJson(latestPath, latest);

  console.log(JSON.stringify({
    ok: true,
    date_key: dateKey,
    cycle,
    exchange,
    signal_file: signalFile,
    audit_file: auditFile,
    output_latest: latestPath,
    signal_summary: latest.signal_summary,
    audit_summary: {
      fills_count: latest.audit_summary.fills_count ?? null,
      issue_count: latest.audit_summary.issue_count ?? null,
      duplicate_signal_fill_count: latest.audit_summary.duplicate_signal_fill_count ?? null,
      qty_pct_non_positive_count: latest.audit_summary.qty_pct_non_positive_count ?? null,
    },
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error("refresh-execution-flow-cycles failed:", err && err.message ? err.message : err);
  process.exit(1);
}
