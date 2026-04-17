"use strict";

// Phase 3d — file-based operator override for the live execution policy.
//
// Problem:
//   The 2026-04-17 perf diagnosis found the system stuck in a negative
//   feedback loop: objective_score -8.26 → auto-quarantine → fewer entries
//   → smaller realized sample (n=14) → no statistical recovery → stays
//   quarantined. We cannot run a grid search or recover performance without
//   a bounded window where entries can flow.
//
// Solution:
//   An operator writes a short-lived override file at
//   ops/runtime/operator_overrides.json that can:
//     1. Relax the QUARANTINE_HARD_BLOCK gate (only when liveExecutionPolicy
//        would otherwise hard-block on quarantine), until an explicit UTC
//        expiry.
//     2. Apply per-market qty-scale multipliers (e.g. AXSUSDT 1.2x) until
//        expiry.
//
// Safety:
//   - Every override requires `expires_at_iso`. An expired override is
//     ignored (treated as no override). There is no default 'forever'.
//   - Overrides only loosen gates that were BLOCKING — they never create a
//     new entry opportunity against other invariants (ledger, stop writer,
//     etc.).
//   - Every application is logged once (per-key) so the operator can see
//     the effect in logs.
//   - Missing / malformed file = no override (fail-closed back to default).

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "../..");
const DEFAULT_PATH = path.join(REPO_ROOT, "ops", "runtime", "operator_overrides.json");

const loggedApplications = new Set();

function toUpperSymbol(value) {
  return String(value || "").trim().toUpperCase();
}

function toMsFromIso(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveOverrideFilePath() {
  const envPath = String(process.env.OPERATOR_OVERRIDES_PATH || "").trim();
  return envPath || DEFAULT_PATH;
}

function readOverrideFile({ filePath = resolveOverrideFilePath(), nowMs = Date.now() } = {}) {
  let stats = null;
  try {
    stats = fs.statSync(filePath);
  } catch (_) {
    return { present: false, expired: false, payload: null, path: filePath, mtimeMs: null };
  }
  let payload = null;
  try {
    payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return { present: true, expired: false, payload: null, parseError: true, path: filePath, mtimeMs: stats.mtimeMs };
  }
  const expiresAtMs = toMsFromIso(payload && payload.expires_at_iso);
  if (!Number.isFinite(expiresAtMs)) {
    // Missing expiry → reject (fail-closed — we never want a forever override)
    return { present: true, expired: true, payload, reason: "NO_EXPIRY", path: filePath, mtimeMs: stats.mtimeMs };
  }
  if (expiresAtMs <= nowMs) {
    return { present: true, expired: true, payload, reason: "EXPIRED", expires_at_ms: expiresAtMs, path: filePath, mtimeMs: stats.mtimeMs };
  }
  return {
    present: true,
    expired: false,
    payload,
    expires_at_ms: expiresAtMs,
    path: filePath,
    mtimeMs: stats.mtimeMs,
  };
}

function emitOneShotLog(key, payload) {
  if (loggedApplications.has(key)) return;
  loggedApplications.add(key);
  console.warn("[OPERATOR_OVERRIDE_APPLIED]", JSON.stringify(payload));
}

function resetForTest() {
  loggedApplications.clear();
}

function resolveOperatorOverrideContext(options = {}) {
  const meta = readOverrideFile(options);
  if (!meta.present) return { active: false };
  if (meta.expired) {
    return {
      active: false,
      expired: true,
      reason: meta.reason || null,
      expires_at_ms: meta.expires_at_ms || null,
      payload: meta.payload || null,
      path: meta.path,
    };
  }
  if (meta.parseError) {
    return { active: false, parseError: true, path: meta.path };
  }
  const payload = meta.payload || {};
  const quarantineRelax = payload.quarantine_hard_block_relaxed === true;
  const marketScalesRaw = payload.market_qty_scales && typeof payload.market_qty_scales === "object"
    ? payload.market_qty_scales
    : null;
  const marketScales = {};
  if (marketScalesRaw) {
    for (const [rawKey, rawVal] of Object.entries(marketScalesRaw)) {
      const key = toUpperSymbol(rawKey);
      const n = Number(rawVal);
      if (!key || !Number.isFinite(n) || n <= 0) continue;
      if (n > 2) continue; // hard safety clamp — never scale above 2x
      marketScales[key] = n;
    }
  }
  return {
    active: true,
    expired: false,
    expires_at_ms: meta.expires_at_ms,
    expires_at_iso: payload.expires_at_iso,
    reason: String(payload.reason || "").trim() || null,
    operator: String(payload.operator || "").trim() || null,
    quarantine_hard_block_relaxed: quarantineRelax,
    market_qty_scales: marketScales,
    payload_path: meta.path,
  };
}

function shouldRelaxQuarantineHardBlock(ctx) {
  if (!ctx || ctx.active !== true) return false;
  if (ctx.quarantine_hard_block_relaxed !== true) return false;
  emitOneShotLog(`quarantine_relax:${ctx.expires_at_iso}`, {
    family: "QUARANTINE_HARD_BLOCK",
    expires_at_iso: ctx.expires_at_iso,
    reason: ctx.reason,
    operator: ctx.operator,
  });
  return true;
}

function resolveMarketQtyScaleOverride(ctx, market) {
  if (!ctx || ctx.active !== true) return null;
  const mk = toUpperSymbol(market);
  if (!mk) return null;
  const scale = ctx.market_qty_scales && Object.prototype.hasOwnProperty.call(ctx.market_qty_scales, mk)
    ? Number(ctx.market_qty_scales[mk])
    : null;
  if (!Number.isFinite(scale) || scale <= 0) return null;
  emitOneShotLog(`market_scale:${mk}:${ctx.expires_at_iso}`, {
    family: "MARKET_QTY_SCALE",
    market: mk,
    scale,
    expires_at_iso: ctx.expires_at_iso,
    reason: ctx.reason,
    operator: ctx.operator,
  });
  return scale;
}

module.exports = {
  DEFAULT_PATH,
  resolveOverrideFilePath,
  readOverrideFile,
  resolveOperatorOverrideContext,
  shouldRelaxQuarantineHardBlock,
  resolveMarketQtyScaleOverride,
  __test: {
    resetForTest,
    toMsFromIso,
    toUpperSymbol,
  },
};
