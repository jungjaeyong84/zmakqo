"use strict";

// src/v3/opsAlert.js — deduplicated operational alerting for the v3 watchers
// (2026-07-16, survival hardening).
//
// Every watcher (deadman, bracket repair, breaker, reconcile) needs the same
// three things: resolve the Telegram channel, decide whether THIS condition
// has already been alerted (with periodic re-arm so a persistent failure is
// not forgotten), and record the send. The decide step is pure and tested;
// the send reuses src/utils/alerts.sendAlert.

const fs = require("fs");
const path = require("path");

function resolveChannel() {
  const explicit = String(process.env.V3_OPS_ALERT_CHANNEL || "").trim();
  if (explicit) return explicit;
  const exitCh = String(process.env.EXIT_INTEGRITY_ALERT_CHANNEL || "").trim();
  if (exitCh) return exitCh;
  const chatId = String(process.env.TELEGRAM_CHAT_ID || "").trim();
  return chatId ? `telegram:${chatId}` : "";
}

// Pure: should we alert for `key` now?
//   state    — { [key]: { last_alert_at_ms, active } }
//   active   — condition currently firing?
//   rearmMs  — while continuously active, re-alert after this long (0 = never)
// Returns { alert: bool, recovered: bool, nextState }
function decideAlert({ state = {}, key, active, nowMs = Date.now(), rearmMs = 6 * 60 * 60 * 1000 } = {}) {
  const prev = (state && state[key]) || { last_alert_at_ms: null, active: false };
  let alert = false;
  let recovered = false;
  const next = { ...prev };

  if (active) {
    if (!prev.active) {
      alert = true; // transition into failure
      next.last_alert_at_ms = nowMs;
    } else if (rearmMs > 0 && prev.last_alert_at_ms !== null && (nowMs - prev.last_alert_at_ms) >= rearmMs) {
      alert = true; // still failing — periodic reminder
      next.last_alert_at_ms = nowMs;
    }
    next.active = true;
  } else {
    if (prev.active) recovered = true; // transition back to healthy
    next.active = false;
  }

  return Object.freeze({
    alert,
    recovered,
    nextState: Object.freeze({ ...(state || {}), [key]: Object.freeze(next) }),
  });
}

function readState(stateFile) {
  try { return JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch (_) { return {}; }
}
function writeState(stateFile, state) {
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));
  } catch (_) { /* alerting must never crash the cycle */ }
}

// Impure convenience: evaluate + (maybe) send + persist. Returns what happened.
async function alertOnce({ stateFile, key, active, title, body, severity = "warn", recoveryTitle = null, rearmMs } = {}) {
  const state = readState(stateFile);
  const d = decideAlert({ state, key, active, rearmMs });
  let sent = false;
  let recoverySent = false;
  const channel = resolveChannel();
  if (channel && (d.alert || (d.recovered && recoveryTitle))) {
    let sendAlert;
    try { ({ sendAlert } = require("../utils/alerts")); } catch (_) { sendAlert = null; }
    if (sendAlert) {
      try {
        if (d.alert) { await sendAlert({ channel, title, body, severity }); sent = true; }
        else if (d.recovered && recoveryTitle) { await sendAlert({ channel, title: recoveryTitle, body: body || "", severity: "info" }); recoverySent = true; }
      } catch (_) { /* send failure must not crash the cycle */ }
    }
  }
  writeState(stateFile, d.nextState);
  return { alerted: sent, recovered: recoverySent, decided_alert: d.alert, decided_recovered: d.recovered };
}

module.exports = Object.freeze({ resolveChannel, decideAlert, alertOnce, __test: { readState, writeState } });
