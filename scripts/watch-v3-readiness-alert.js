#!/usr/bin/env node
"use strict";

// scripts/watch-v3-readiness-alert.js
//
// launchd-driven watcher: alerts (Telegram) the MOMENT v3 paper validation
// readiness flips to READY_FOR_RUNTIME_LANE_REVIEW. Runs independently of any
// Claude session so a multi-day/week wait is caught reliably.
//
// Dedup: alerts only on the transition INTO ready (prior readiness != READY).
// While readiness stays READY the watcher is silent; if it drops back to a
// WAIT/FAILS state and later returns to READY, it alerts again. State is kept
// in ops/runtime/v3_readiness_watch_state.json.
//
// Reuses the system's own alert channel (src/utils/alerts.sendAlert), so it
// speaks to the same Telegram bot/chat as the rest of the stack.

const fs = require("fs");
const path = require("path");

// Load env: .env (TELEGRAM_CHAT_ID, EXIT_INTEGRITY_ALERT_CHANNEL) is sourced
// by the launchd runner, but load it here too so a manual run works.
try { require("dotenv").config(); } catch (_) { /* dotenv optional */ }

const ROOT = path.resolve(__dirname, "..");
const VALIDATION = path.join(ROOT, "ops/daily/v3_paper_validation_latest.json");
const PERF = path.join(ROOT, "ops/daily/v3_paper_performance_latest.json");
const STATE = path.join(ROOT, "ops/runtime/v3_readiness_watch_state.json");
const READY = "READY_FOR_RUNTIME_LANE_REVIEW";

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (_) { return null; }
}

function resolveChannel() {
  const explicit = String(process.env.V3_READINESS_ALERT_CHANNEL || "").trim();
  if (explicit) return explicit;
  const exitCh = String(process.env.EXIT_INTEGRITY_ALERT_CHANNEL || "").trim();
  if (exitCh) return exitCh;
  const chatId = String(process.env.TELEGRAM_CHAT_ID || "").trim();
  return chatId ? `telegram:${chatId}` : "";
}

async function main() {
  const v = readJson(VALIDATION);
  if (!v || typeof v.readiness !== "string") {
    process.stdout.write(`[v3-readiness-watch] validation artifact unreadable — skip\n`);
    return;
  }
  const readiness = v.readiness;
  const prior = readJson(STATE) || {};
  const priorReadiness = String(prior.readiness || "");

  // persist current readiness every run (for transition detection)
  const writeState = (extra = {}) => {
    try {
      fs.mkdirSync(path.dirname(STATE), { recursive: true });
      fs.writeFileSync(STATE, JSON.stringify({
        readiness,
        checked_at: new Date().toISOString(),
        ...extra,
      }, null, 2));
    } catch (e) {
      process.stdout.write(`[v3-readiness-watch] state write fail: ${e && e.message}\n`);
    }
  };

  if (readiness !== READY) {
    writeState();
    process.stdout.write(`[v3-readiness-watch] not ready (${readiness}) — quiet\n`);
    return;
  }

  if (priorReadiness === READY) {
    // already alerted on this READY streak — stay silent
    writeState({ last_alert_at: prior.last_alert_at || null });
    process.stdout.write(`[v3-readiness-watch] still READY (already alerted) — quiet\n`);
    return;
  }

  // transition into READY → alert
  const perf = readJson(PERF) || {};
  const cp = perf.current_policy_metrics_r || {};
  const rolling = (v.rolling_trade_windows || [])
    .map((w) => `${w.label}: WR ${w.metrics && w.metrics.win_rate_pct}% exp ${w.metrics && w.metrics.expectancy_r}R`)
    .join("\n");
  const body = [
    `readiness: ${readiness}`,
    `bootstrap_gate.ok: ${v.bootstrap_gate && v.bootstrap_gate.ok} | paper_gate.ok: ${v.paper_gate && v.paper_gate.ok}`,
    `current-policy: n=${cp.sample_n} WR ${cp.win_rate_pct}% exp ${cp.expectancy}R PF ${cp.profit_factor} net ${cp.net}R`,
    ``,
    rolling,
    ``,
    `다음 단계: 마이크로 라이브(1/10) + 실거래 실행 레이어 착수 결정.`,
    `주의: READY는 rolling 딥이 걷혔다는 의미일 뿐 — 라이브 엣지는 여전히 얇고(~+0.08R 추정) 실행 레이어는 미구축.`,
  ].join("\n");

  const channel = resolveChannel();
  if (!channel) {
    process.stdout.write(`[v3-readiness-watch] READY but NO alert channel resolved — set EXIT_INTEGRITY_ALERT_CHANNEL or TELEGRAM_CHAT_ID\n`);
    writeState();
    return;
  }

  let sendAlert;
  try { ({ sendAlert } = require("../src/utils/alerts")); }
  catch (e) { process.stdout.write(`[v3-readiness-watch] alerts module load fail: ${e && e.message}\n`); writeState(); return; }

  try {
    const res = await sendAlert({
      channel,
      title: "🟢 v3 READY 도달 (READY_FOR_RUNTIME_LANE_REVIEW)",
      body,
      severity: "info",
    });
    process.stdout.write(`[v3-readiness-watch] READY transition — alert sent ok=${res && res.ok}\n`);
    writeState({ last_alert_at: new Date().toISOString(), last_alert_ok: !!(res && res.ok) });
  } catch (e) {
    process.stdout.write(`[v3-readiness-watch] alert send fail: ${e && e.message}\n`);
    writeState();
  }
}

main().catch((e) => {
  process.stdout.write(`[v3-readiness-watch] FATAL ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
