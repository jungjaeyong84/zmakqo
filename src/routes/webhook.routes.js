const fs = require("fs");
const path = require("path");
const express = require("express");
const rateLimit = require("express-rate-limit");
const env = require("../config/env");
const { upsertSignal } = require("../storage/signals");
const { recordSignalDrops } = require("../storage/signalDrops");
const { getPosition } = require("../storage/positionsPaper");
const { deriveGroupSubtype } = require("../services/signalTaxonomy");
const { resolveEventMapping, SIGNAL_MAPPING_VERSION } = require("../services/signalMapping");
const { evaluateSignalWithAi } = require("../services/aiSignalGuard");
const { getExchangeSettingsForProvider } = require("../utils/exchangeSettings");
const { inferExchangeFromMarket } = require("../utils/marketExchange");
const { normalizeMarketSymbolForProvider, normalizeMarketsList, normalizeTf, tfToMs, defaultTfAllowlistFromEnv, defaultExecTfFromEnv } = require("../utils/marketConfig");
const { normalizeExchangeId } = require("../exchanges");
const { getFirestore } = require("../storage/firestore");
const { getSystemSettingsForProvider } = require("../storage/settings");
const { buildWebhookRequestId, recordWebhookIngress, recordWebhookOutcome } = require("../storage/webhookLedger");
const { normalizeProviderId, pickProviderEntry } = require("../utils/providerUtils");
const { normalizePositionSide } = require("../utils/positionSide");
const { alignBarCloseMs } = require("../utils/alignBarCloseMs");
const { resolveFebtShadow } = require("../utils/febtShadow");
const { mergeFebtPayloadContract } = require("../utils/febtPayloadContract");
const {
  resolveSelfEvolutionRuntimeState,
  confirmSelfEvolutionRuntimeSignal,
} = require("../utils/selfEvolutionRuntimeState");
const { runOneMarket } = require("../scheduler/marketRunner");
const { resolveExecTfForExchange } = require("../utils/resolveExchange");
const { sendSignalDroppedAlert } = require("../services/signalLifecycleAlert");
const { fetchBinanceFuturesAccount } = require("../exchanges/binanceFuturesPrivate");
const { resolveBinanceFuturesKeys } = require("../utils/binanceKeyResolver");
const { canonicalExternalEntryEvent, resolveEntryTimingTier } = require("../utils/liveEntryTaxonomy");
const {
  isReverseDropReason,
  isReverseExceptionTierEvent,
  resolveReverseExceptionConfig,
  summarizeOppositeReverseDrops,
  shouldReviveReverseDrop,
  normalizeReasonCode,
  sideToPositionDir,
} = require("../services/webhookReverseException");

const ROOT = path.resolve(__dirname, "../..");
const OPS_DAILY = path.join(ROOT, "ops", "daily");
const SELF_EVOLUTION_MANUAL_PASTE_ACK_LATEST = path.join(OPS_DAILY, "self_evolution_manual_paste_ack_latest.json");
const SELF_EVOLUTION_DEPLOYMENT_PLAN_LATEST = path.join(OPS_DAILY, "best_self_evolution_deployment_plan_latest.json");
const WEBHOOK_SIGNAL_EXECUTION_PROBE_LATEST = path.join(OPS_DAILY, "webhook_signal_execution_probe_latest.json");
const DEFAULT_STRATEGY_ID = process.env.DONBEOLJA_STRATEGY_ID || "STRAT_v010";

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_err) {
    return null;
  }
}

function writeJsonSafe(filePath, payload) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
    return true;
  } catch (_err) {
    return false;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function toKstString(iso = null) {
  const date = iso ? new Date(iso) : new Date();
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} KST`;
}

function persistWebhookSignalExecutionProbe({
  requestId = null,
  exchange = null,
  symbol = null,
  tf = null,
  signalId = null,
  phase = null,
  summary = null,
  saved = null,
} = {}) {
  const generatedAt = nowIso();
  const payload = {
    generated_at: generatedAt,
    generated_at_kst: toKstString(generatedAt),
    request_id: requestId || null,
    exchange: exchange || null,
    symbol: symbol || null,
    tf: tf || null,
    signal_id: signalId || null,
    phase: phase || null,
    saved: saved === true,
    summary: summary && typeof summary === "object" ? summary : null,
  };
  writeJsonSafe(WEBHOOK_SIGNAL_EXECUTION_PROBE_LATEST, payload);
}

function fireSignalDroppedAlert(payload = {}) {
  sendSignalDroppedAlert(payload).catch((err) => {
    console.warn("[SIGNAL_DROPPED_ALERT_FAIL]", err?.message || err);
  });
}

function parseAllowedStrategyIds(raw) {
  return Array.from(new Set(
    String(raw || "")
      .split(",")
      .map((s) => String(s || "").trim())
      .filter(Boolean)
  ));
}

function buildRuntimeStrategyGate({
  envDefaultStrategyId = DEFAULT_STRATEGY_ID,
  envAllowedStrategyIds = [],
  manualPasteAck = null,
  deploymentSummary = null,
} = {}) {
  const safeEnvDefaultStrategyId = String(envDefaultStrategyId || "").trim() || "STRAT_v010";
  const safeEnvAllowedStrategyIds = Array.isArray(envAllowedStrategyIds)
    ? envAllowedStrategyIds.map((row) => String(row || "").trim()).filter(Boolean)
    : parseAllowedStrategyIds(envAllowedStrategyIds || safeEnvDefaultStrategyId);
  const safeDeploymentSummary = deploymentSummary && typeof deploymentSummary === "object"
    ? deploymentSummary
    : {};
  const safeManualPasteAck = manualPasteAck && typeof manualPasteAck === "object" ? manualPasteAck : {};
  const appliedStrategyId = String(
    safeDeploymentSummary.applied_strategy_id
    || safeManualPasteAck.applied_strategy_id
    || ""
  ).trim() || null;
  const preparedReady = (
    safeManualPasteAck.prepared_stage_ready === true
    && (
      safeManualPasteAck.ready_for_manual_paste === true
      || String(safeManualPasteAck.plan_status || "").trim().toUpperCase() === "READY_FOR_MANUAL_PASTE"
    )
  ) || (
    safeDeploymentSummary.prepared_stage_ready === true
    && (
      safeDeploymentSummary.ready_for_manual_paste === true
      || String(safeDeploymentSummary.plan_status || "").trim().toUpperCase() === "READY_FOR_MANUAL_PASTE"
    )
  );
  const preparedStrategyId = preparedReady
    ? (String(
      safeManualPasteAck.prepared_strategy_id
      || safeDeploymentSummary.prepared_strategy_id
      || ""
    ).trim() || null)
    : null;
  const manualPasteAcknowledged = safeManualPasteAck.acknowledged === true || safeDeploymentSummary.manual_paste_acknowledged === true;
  const liveSignalConfirmationPending = safeManualPasteAck.live_signal_confirmation_pending === true
    || safeDeploymentSummary.live_signal_confirmation_pending === true;
  const liveSignalConfirmed = safeManualPasteAck.live_signal_confirmed === true
    || safeDeploymentSummary.live_signal_confirmed === true;
  const runtimeDefaultStrategyId = (manualPasteAcknowledged || liveSignalConfirmationPending || liveSignalConfirmed) && appliedStrategyId
    ? appliedStrategyId
    : safeEnvDefaultStrategyId;
  const allowedStrategyIds = Array.from(new Set([
    ...safeEnvAllowedStrategyIds,
    runtimeDefaultStrategyId,
    appliedStrategyId,
    preparedStrategyId,
  ].filter(Boolean)));

  return {
    defaultStrategyId: runtimeDefaultStrategyId,
    allowedStrategyIds,
    allowedStrategySet: new Set(allowedStrategyIds),
    source: {
      env_default_strategy_id: safeEnvDefaultStrategyId,
      env_allowed_strategy_ids: safeEnvAllowedStrategyIds,
      applied_strategy_id: appliedStrategyId,
      prepared_strategy_id: preparedStrategyId,
      prepared_ready: preparedReady,
      manual_paste_acknowledged: manualPasteAcknowledged,
      live_signal_confirmation_pending: liveSignalConfirmationPending,
      live_signal_confirmed: liveSignalConfirmed,
    },
  };
}

function firstTrimmedStrategyValue(...values) {
  for (const value of values) {
    if (value == null) continue;
    const trimmed = String(value).trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function resolvePayloadStrategyIdentity({
  payload = null,
  featureObj = null,
  featureJsonObj = null,
  defaultStrategyId = null,
} = {}) {
  const read = (obj, keys = []) => {
    if (!obj || typeof obj !== "object") return null;
    for (const key of keys) {
      if (obj[key] == null) continue;
      const trimmed = String(obj[key]).trim();
      if (trimmed) return trimmed;
    }
    return null;
  };

  const canonicalId = firstTrimmedStrategyValue(
    read(payload, ["strategy_id", "strategyId"]),
    read(featureObj, ["strategy_id", "strategyId"]),
    read(featureJsonObj, ["strategy_id", "strategyId"])
  );
  const aliasId = firstTrimmedStrategyValue(
    read(payload, ["strategy", "strategy_name", "strategyName"]),
    read(featureObj, ["strategy", "strategy_name", "strategyName"]),
    read(featureJsonObj, ["strategy", "strategy_name", "strategyName"])
  );
  const effectiveStrategyId = canonicalId || aliasId || firstTrimmedStrategyValue(defaultStrategyId);

  return {
    canonicalId,
    aliasId,
    present: canonicalId != null || aliasId != null,
    effectiveStrategyId,
  };
}

async function resolveRuntimeStrategyGate() {
  const envDefaultStrategyId = String(DEFAULT_STRATEGY_ID || "").trim() || "STRAT_v010";
  const envAllowedStrategyIds = parseAllowedStrategyIds(process.env.WEBHOOK_ALLOWED_STRATEGY_IDS || envDefaultStrategyId);
  const runtimeState = await resolveSelfEvolutionRuntimeState({ ttlMs: 30_000 });
  const manualPasteAck = runtimeState && runtimeState.data
    ? runtimeState.data
    : (readJsonSafe(SELF_EVOLUTION_MANUAL_PASTE_ACK_LATEST) || {});
  const deploymentPlan = readJsonSafe(SELF_EVOLUTION_DEPLOYMENT_PLAN_LATEST) || {};
  const deploymentSummary = deploymentPlan && deploymentPlan.summary && typeof deploymentPlan.summary === "object"
    ? deploymentPlan.summary
    : {};
  const gate = buildRuntimeStrategyGate({
    envDefaultStrategyId,
    envAllowedStrategyIds,
    manualPasteAck,
    deploymentSummary,
  });
  gate.source.runtime_state_source = runtimeState && runtimeState.source ? runtimeState.source : "local";
  gate.source.runtime_state_error = runtimeState && runtimeState.error ? runtimeState.error : null;
  return gate;
}

function createWebhookRoutes() {
  const router = express.Router();
  const WEBHOOK_STRATEGY_GATE_ENABLED = ["1", "true", "yes", "y", "on"].includes(
    String(process.env.WEBHOOK_STRATEGY_GATE_ENABLED || "1").trim().toLowerCase()
  );
  const WEBHOOK_STRATEGY_REQUIRE_ID = ["1", "true", "yes", "y", "on"].includes(
    String(process.env.WEBHOOK_STRATEGY_REQUIRE_ID || "1").trim().toLowerCase()
  );
  const WEBHOOK_IMMEDIATE_PROCESS = String(process.env.WEBHOOK_IMMEDIATE_PROCESS || "1") === "1";
  const WEBHOOK_IMMEDIATE_TIMEOUT_MS = Number(process.env.WEBHOOK_IMMEDIATE_TIMEOUT_MS || 30000);
  const WEBHOOK_IMMEDIATE_RETRY_MAX = Math.max(0, Number(process.env.WEBHOOK_IMMEDIATE_RETRY_MAX || 2));
  const WEBHOOK_IMMEDIATE_RETRY_DELAY_MS = Math.max(0, Number(process.env.WEBHOOK_IMMEDIATE_RETRY_DELAY_MS || 1000));
  const WEBHOOK_IMMEDIATE_RETRY_TIMEOUT_MS = Math.max(
    1000,
    Number(process.env.WEBHOOK_IMMEDIATE_RETRY_TIMEOUT_MS || 45000)
  );
  const WEBHOOK_AUTO_REGISTER_MARKET = String(process.env.WEBHOOK_AUTO_REGISTER_MARKET || "0") === "1";
  const WEBHOOK_EXIT_ALL_RECAST_TO_SHORT = ["1", "true", "yes", "y", "on"].includes(
    String(process.env.WEBHOOK_EXIT_ALL_RECAST_TO_SHORT || "0").trim().toLowerCase()
  );
  const AI_CAN_BLOCK = ["1", "true", "yes", "y", "on"].includes(String(process.env.SIGNAL_AI_CAN_BLOCK || "0").trim().toLowerCase());
  const AI_FAIL_MODE = String(process.env.SIGNAL_AI_FAIL_MODE || "ALLOW").trim().toUpperCase();
  /* WEBHOOK_NORMALIZE_V2 */
  async function isAllowedTf(exchange, tf) {
    const cfg = await getExchangeSettingsForProvider(exchange || "BINANCEFUT", 5000);
    const allowed = Array.isArray(cfg.tf_allowlist) ? cfg.tf_allowlist.map(normalizeTf).filter(Boolean) : [];
    if (!allowed.length) return true;
    return allowed.includes(tf);
  }

  async function ensureMarketRegistered(exchange, symbol) {
    try {
      const provider = normalizeProviderId(exchange || "");
      if (!provider || !symbol) return;
      const cfg = await getExchangeSettingsForProvider(provider, 2000);
      if (cfg && cfg.locked_by_env) return;
      const db = getFirestore();
      const doc = await db.collection("settings").doc("exchanges").get();
      const data = doc.exists ? (doc.data() || {}) : {};
      const map = (data.exchanges && typeof data.exchanges === "object") ? data.exchanges : {};
      const entry = pickProviderEntry(map, provider) || {};
      const cur = normalizeMarketsList(entry.markets || [], provider);
      const next = Array.from(new Set([...(cur || []), symbol])).filter(Boolean);
      if (next.length === cur.length) return;
      const tfAllow = (Array.isArray(entry.tf_allowlist) && entry.tf_allowlist.length)
        ? entry.tf_allowlist
        : (Array.isArray(data.tf_allowlist) && data.tf_allowlist.length ? data.tf_allowlist : defaultTfAllowlistFromEnv());
      const execTf = normalizeTf((entry.exec_tf) || data.exec_tf || defaultExecTfFromEnv());
      const nowIso = new Date().toISOString();
      const patch = {
        exchanges: {
          ...map,
          [provider]: {
            ...entry,
            provider,
            enabled: typeof entry.enabled === "boolean" ? entry.enabled : true,
            markets: next,
            tf_allowlist: tfAllow,
            exec_tf: execTf,
            updated_at: nowIso,
            updated_by: "webhook:auto",
          },
        },
      };
      if (normalizeProviderId(data.provider) === provider) {
        patch.markets = next;
        patch.updated_at = nowIso;
        patch.updated_by = "webhook:auto";
      }
      await db.collection("settings").doc("exchanges").set(patch, { merge: true });
    } catch (err) {
      console.warn("[MARKET_REGISTER_FAIL]", err?.message || err);
    }
  }

  function buildAiTimeoutFallback(qtyPct) {
    const qtyBase = Number(qtyPct);
    const qtySafe = Number.isFinite(qtyBase) && qtyBase > 0 ? qtyBase : 0;
    const qtyReduced = qtySafe > 0 ? qtySafe * 0.5 : 0;
    const meta = {
      ai_enabled: true,
      ai_ok: false,
      ai_reason: "AI_EVAL_TIMEOUT",
      ai_timeout_ms: AI_EVAL_TIMEOUT_MS,
      ai_webhook_timeout_guard: true,
      ai_fail_mode: AI_FAIL_MODE,
    };
    if (AI_FAIL_MODE === "BLOCK") {
      return {
        ok: true,
        decision: "BLOCK",
        qty_pct_final: 0,
        meta: {
          ...meta,
          ai_decision: "BLOCK",
          ai_qty_final: 0,
        },
      };
    }
    if (AI_FAIL_MODE === "REDUCE") {
      const decision = qtyReduced > 0 ? "REDUCE" : "BLOCK";
      return {
        ok: true,
        decision,
        qty_pct_final: decision === "REDUCE" ? qtyReduced : 0,
        meta: {
          ...meta,
          ai_decision: decision,
          ai_qty_final: decision === "REDUCE" ? qtyReduced : 0,
        },
      };
    }
    return {
      ok: false,
      meta: {
        ...meta,
        ai_decision: "ALLOW",
        ai_qty_final: Number.isFinite(qtyBase) ? qtyBase : null,
      },
    };
  }

  function parseBarCloseMs(rawMs, rawUtc, tf) {
    // Prefer bar_close_time_utc when provided; some send bar "open" in *_ms.
    if (rawMs === null || rawMs === undefined || rawMs === "") {
      rawMs = null;
    }
    let utcMs = null;
    if (typeof rawUtc === "string") {
      const parsed = Date.parse(rawUtc);
      if (Number.isFinite(parsed)) utcMs = parsed;
    }

    let ms = Number(rawMs);
    if (!Number.isFinite(ms) && typeof rawMs === "string") {
      const parsed = Date.parse(rawMs);
      if (Number.isFinite(parsed)) ms = parsed;
    }
    if (Number.isFinite(ms) && ms > 0 && ms < 1e12) {
      // seconds → ms
      ms = ms * 1000;
    }

    if (Number.isFinite(utcMs) && Number.isFinite(ms)) {
      const tfMs = tfToMs(tf);
      const threshold = Number.isFinite(tfMs) ? Math.max(60 * 1000, tfMs / 2) : 30 * 60 * 1000;
      if (Math.abs(utcMs - ms) >= threshold) return Math.max(utcMs, ms);
      return utcMs;
    }
    if (Number.isFinite(utcMs)) return utcMs;
    return Number.isFinite(ms) ? ms : null;
  }

  function normalizeBarCloseUtc(barCloseUtcStr, barCloseMs, tf) {
    if (!Number.isFinite(barCloseMs)) return barCloseUtcStr || null;
    const parsed = barCloseUtcStr ? Date.parse(barCloseUtcStr) : null;
    if (!Number.isFinite(parsed)) return new Date(barCloseMs).toISOString();
    const tfMs = tfToMs(tf);
    const threshold = Number.isFinite(tfMs) ? Math.max(60 * 1000, tfMs / 2) : 30 * 60 * 1000;
    if (Math.abs(parsed - barCloseMs) >= threshold) return new Date(barCloseMs).toISOString();
    return barCloseUtcStr;
  }

  function isSpotExchange(ex) {
    return false;
  }

  function withTimeout(promise, ms) {
    if (!Number.isFinite(ms) || ms <= 0) return promise;
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("IMMEDIATE_PROCESS_TIMEOUT")), ms);
    });
    return Promise.race([
      Promise.resolve(promise).finally(() => {
        if (timer) clearTimeout(timer);
      }),
      timeout,
    ]);
  }

  function sleep(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function triggerImmediateProcess({ exchange, symbol, tf, signalId }) {
    if (!WEBHOOK_IMMEDIATE_PROCESS) {
      return { ok: false, skipped: true, reason: "IMMEDIATE_DISABLED" };
    }
    if (!exchange || !symbol || !tf) {
      return { ok: false, skipped: true, reason: "IMMEDIATE_MISSING_PARAMS" };
    }

    const sys = await getSystemSettingsForProvider(exchange || "BINANCEFUT", 3000);
    const sysData = sys && sys.data ? sys.data : {};
    if (sysData.scheduler_enabled === false) {
      return { ok: false, skipped: true, reason: "SCHEDULER_DISABLED" };
    }

    const execMode = String(sysData.execution_mode || "PAPER").toUpperCase();
    const executionEnabled = execMode === "PAPER"
      ? env.paper.enabled === true
      : (execMode === "LIVE" ? sysData.live_enabled === true : true);
    if (!executionEnabled) {
      return { ok: false, skipped: true, reason: "EXECUTION_DISABLED", execution_mode: execMode };
    }

    const execTf = await resolveExecTfForExchange(exchange, tf, 2000);
    const maxAttempts = 1 + WEBHOOK_IMMEDIATE_RETRY_MAX;
    const errors = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const timeoutMs = attempt === 1 ? WEBHOOK_IMMEDIATE_TIMEOUT_MS : WEBHOOK_IMMEDIATE_RETRY_TIMEOUT_MS;
      try {
        const runIdHint = `RUN__WEBHOOK__${exchange}__${symbol}__A${attempt}__${Date.now()}`;
        const task = runOneMarket({
          exchange,
          market: symbol,
          signalTf: tf,
          execTf,
          nowMs: Date.now(),
          runIdHint,
          executionEnabled,
          executionMode: execMode,
          allowReplaySameBar: true,
        });
        const res = await withTimeout(task, timeoutMs);
        return { ok: true, result: res, signal_id: signalId || null, attempt, timeout_ms: timeoutMs };
      } catch (err) {
        const errMsg = err?.message || String(err);
        errors.push({ attempt, timeout_ms: timeoutMs, error: errMsg });
        const isTimeout = errMsg === "IMMEDIATE_PROCESS_TIMEOUT";
        if (!isTimeout || attempt >= maxAttempts) {
          if (err && typeof err === "object") err.immediate_meta = { errors, max_attempts: maxAttempts };
          throw err;
        }
        await sleep(WEBHOOK_IMMEDIATE_RETRY_DELAY_MS * attempt);
      }
    }

    return { ok: false, skipped: true, reason: "IMMEDIATE_RETRY_EXHAUSTED" };
  }

  function summarizeImmediateProcessResult(res) {
    const result = res && res.result ? res.result : null;
    const paper = result && result.paper && typeof result.paper === "object" ? result.paper : null;
    const paperSignalsSeen = paper && Number.isFinite(Number(paper.signals_seen)) ? Number(paper.signals_seen) : 0;
    const paperIntentsCreated = paper && Number.isFinite(Number(paper.intents_created)) ? Number(paper.intents_created) : 0;
    const noDownstreamArtifact = !!(paper && paperSignalsSeen > 0 && paperIntentsCreated === 0 && !paper.error);
    if (result && result.ok === true) {
      return {
        status: noDownstreamArtifact ? "SAVED_WITHOUT_INTENT" : "OK",
        detail: {
          actor_allowed: result.actor_allowed === true,
          new_bar: result.new_bar === true,
          gate_status: result.gate && result.gate.status || null,
          gate_reason_codes: result.gate && Array.isArray(result.gate.reasonCodes) ? result.gate.reasonCodes : [],
          trading_mode: result.trading_mode || null,
          paper_ok: paper ? paper.ok === true : null,
          paper_error: paper && paper.error ? String(paper.error) : null,
          intents_created: paper ? paperIntentsCreated : null,
          signals_seen: paper ? paperSignalsSeen : null,
          signals_external: paper && Number.isFinite(Number(paper.signals_external)) ? Number(paper.signals_external) : null,
          signals_internal: paper && Number.isFinite(Number(paper.signals_internal)) ? Number(paper.signals_internal) : null,
          signals_external_late: paper && Number.isFinite(Number(paper.signals_external_late)) ? Number(paper.signals_external_late) : null,
          no_downstream_artifact: noDownstreamArtifact,
          error: null,
        },
      };
    }
    const explicitReason = res && res.reason ? String(res.reason) : "";
    const runtimeError = result && result.error ? String(result.error) : "";
    const gateStatus = result && result.gate && result.gate.status ? String(result.gate.status) : "";
    const actorAllowed = result && Object.prototype.hasOwnProperty.call(result, "actor_allowed")
      ? result.actor_allowed === true
      : null;
    const status = runtimeError
      || explicitReason
      || (actorAllowed === false ? "ACTOR_NOT_ALLOWED" : "")
      || (gateStatus ? `GATE_${gateStatus}` : "")
      || "SKIPPED";
    return {
      status,
      detail: {
        actor_allowed: actorAllowed,
        new_bar: result && Object.prototype.hasOwnProperty.call(result, "new_bar") ? result.new_bar === true : null,
        gate_status: gateStatus || null,
        gate_reason_codes: result && result.gate && Array.isArray(result.gate.reasonCodes) ? result.gate.reasonCodes : [],
        trading_mode: result && result.trading_mode ? result.trading_mode : null,
        paper_ok: paper ? paper.ok === true : null,
        paper_error: paper && paper.error ? String(paper.error) : null,
        intents_created: paper ? paperIntentsCreated : null,
        signals_seen: paper ? paperSignalsSeen : null,
        signals_external: paper && Number.isFinite(Number(paper.signals_external)) ? Number(paper.signals_external) : null,
        signals_internal: paper && Number.isFinite(Number(paper.signals_internal)) ? Number(paper.signals_internal) : null,
        signals_external_late: paper && Number.isFinite(Number(paper.signals_external_late)) ? Number(paper.signals_external_late) : null,
        no_downstream_artifact: noDownstreamArtifact,
        error: runtimeError || null,
        error_stack: result && result.error_stack ? String(result.error_stack) : null,
      },
    };
  }

  function isExitAllEvent(eventRaw) {
    const ev = String(eventRaw || "").trim().toUpperCase();
    return ev === "EXIT_ALL" || ev === "EXIT_FORCE_ALL" || ev === "FORCE_EXIT_ALL";
  }

  function normalizeTpP1EventForExchange(eventRaw, exchange) {
    const ev = String(eventRaw || "").trim().toUpperCase();
    const ex = normalizeExchangeId(exchange || "");
    if (ex === "BINANCEFUT" && ev === "EXIT_TP_P1_5P") return "EXIT_TP_P1_3P";
    return ev;
  }

  function allowSideByExchange({ exchange, intent, side }) {
    if (!isSpotExchange(exchange)) return true;
    if (intent === "ENTRY" || intent === "ADD") return side === "BUY";
    if (intent === "EXIT") return side === "SELL";
    return true;
  }

  function isExitLikeEvent(event) {
    const e = String(event || "").toUpperCase();
    if (!e) return false;
    if (e.startsWith("EXIT_") || e.startsWith("TP_") || e.startsWith("SL_")) return true;
    if (e.includes("STOP_LOSS") || e.includes("TAKE_PROFIT")) return true;
    return false;
  }

  function normalizePositionSnapshot(pos) {
    if (!pos || typeof pos !== "object") {
      return { active: false, side: null, size_pct: 0 };
    }
    const sizeRaw = pos.size_pct ?? pos.sizePct ?? pos.qty_pct ?? pos.qtyPct ?? 0;
    const sizePct = Number(sizeRaw);
    const active = Number.isFinite(sizePct) && sizePct > 0;
    const sideRaw = pos.position_side || pos.positionSide || pos.side || null;
    const side = normalizePositionSide(sideRaw, null);
    return { active, side, size_pct: active ? sizePct : 0 };
  }

  function normalizeEntryIntentWithPosition({ intent, side, posSnap } = {}) {
    const intentRaw = String(intent || "").trim().toUpperCase();
    if (intentRaw !== "ENTRY" && intentRaw !== "ADD") {
      return { intent: intentRaw || null, reason: null };
    }
    const snap = posSnap || { active: false, side: null };
    if (intentRaw === "ADD" && !snap.active) {
      return { intent: "ENTRY", reason: "POS_FLAT_ADD_TO_ENTRY" };
    }
    return { intent: intentRaw, reason: null };
  }

  function normalizeBoolValue(raw, fallback = false) {
    if (raw === null || raw === undefined || raw === "") return fallback;
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "number") return raw !== 0;
    const text = String(raw).trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(text)) return true;
    if (["0", "false", "no", "n", "off"].includes(text)) return false;
    return fallback;
  }

  function resolvePineStage1BundleMeta(features) {
    const f = (features && typeof features === "object") ? features : {};
    const owner = String(f.pine_stage1_bundle_owner || "").trim().toUpperCase();
    const version = String(f.pine_stage1_bundle_version || "").trim();
    const enabled = normalizeBoolValue(f.pine_stage1_bundle_enabled, false);
    const owned = normalizeBoolValue(f.pine_stage1_bundle_owned, false);
    const stagePass = normalizeBoolValue(f.pine_stage1_bundle_stage_pass, false);
    const qualityRuntime = normalizeBoolValue(f.pine_stage1_bundle_quality_filter_runtime, false);
    const trustedVersion = version === "REGIME_SCORE_CONF_POSTERIOR_WAVE_EV_V2";
    const declaredOwned = enabled === true && owner === "PINE" && owned === true;
    return {
      owner,
      version,
      enabled,
      owned,
      stagePass,
      qualityRuntime,
      trustedVersion,
      declaredOwned,
      semanticReject: declaredOwned && qualityRuntime === true && trustedVersion === true && stagePass === false,
    };
  }

  function isStaleAddDropReason(raw) {
    const code = normalizeReasonCode(raw);
    return code === "ADD_BLOCKED"
      || code === "COST_SHIELD_ADD_BLOCKED"
      || code === "REVERSE_BLOCKED"
      || code === "REVERSE_COOLDOWN";
  }

  async function loadRecentDroppedSignalsSince(entryExecBarMs, limit = 300) {
    const db = getFirestore();
    let query = db.collection("signals_dropped");
    if (Number.isFinite(Number(entryExecBarMs)) && Number(entryExecBarMs) > 0) {
      query = query
        .where("bar_close_time_utc_ms", ">=", Number(entryExecBarMs))
        .orderBy("bar_close_time_utc_ms", "desc");
    } else {
      query = query.orderBy("created_at", "desc");
    }
    const snap = await query.limit(limit).get();
    return snap.docs.map((doc) => doc.data() || {});
  }

  async function resolveLiveBinancePositionPnlPct(symbol) {
    const keys = await resolveBinanceFuturesKeys({ ttlMs: 3000 });
    const apiKey = String(keys && keys.apiKey || "").trim();
    const apiSecret = String(keys && keys.apiSecret || "").trim();
    if (!apiKey || !apiSecret) {
      return { ok: false, reason: "BINANCEFUT_KEYS_MISSING", detail: { key_source: keys && keys.source ? keys.source : "missing" } };
    }
    const account = await fetchBinanceFuturesAccount({ apiKey, apiSecret });
    const rows = Array.isArray(account && account.positions) ? account.positions : [];
    const target = normalizeMarketSymbolForProvider(symbol, "BINANCEFUT");
    const row = rows.find((item) => normalizeMarketSymbolForProvider(item && item.symbol, "BINANCEFUT") === target);
    if (!row) return { ok: false, reason: "BINANCE_POSITION_NOT_FOUND" };
    const positionAmt = Number(row.positionAmt);
    if (!Number.isFinite(positionAmt) || positionAmt === 0) {
      return { ok: false, reason: "BINANCE_POSITION_FLAT" };
    }
    const unrealizedProfit = Number(row.unrealizedProfit ?? row.unRealizedProfit);
    const positionInitialMargin = Number(row.positionInitialMargin ?? row.initialMargin);
    const leverage = Number(row.leverage);
    const notionalAbs = Math.abs(Number(row.notional));
    const marginBase = Number.isFinite(positionInitialMargin) && positionInitialMargin > 0
      ? positionInitialMargin
      : ((Number.isFinite(notionalAbs) && notionalAbs > 0 && Number.isFinite(leverage) && leverage > 0)
        ? (notionalAbs / leverage)
        : null);
    if (!Number.isFinite(unrealizedProfit) || !Number.isFinite(marginBase) || marginBase <= 0) {
      return {
        ok: false,
        reason: "BINANCE_POSITION_PNL_UNAVAILABLE",
        detail: {
          unrealized_profit: Number.isFinite(unrealizedProfit) ? unrealizedProfit : null,
          position_initial_margin: Number.isFinite(positionInitialMargin) ? positionInitialMargin : null,
          leverage: Number.isFinite(leverage) ? leverage : null,
          notional_abs: Number.isFinite(notionalAbs) ? notionalAbs : null,
        },
      };
    }
    return {
      ok: true,
      pnlPct: (unrealizedProfit / marginBase) * 100,
      detail: {
        unrealized_profit: unrealizedProfit,
        position_initial_margin: Number.isFinite(positionInitialMargin) ? positionInitialMargin : null,
        leverage: Number.isFinite(leverage) ? leverage : null,
        notional_abs: Number.isFinite(notionalAbs) ? notionalAbs : null,
        mark_price: Number.isFinite(Number(row.markPrice)) ? Number(row.markPrice) : null,
        entry_price: Number.isFinite(Number(row.entryPrice)) ? Number(row.entryPrice) : null,
      },
    };
  }

  function checkToken(req, res, next) {
    const required = process.env.WEBHOOK_TOKEN || "";
    const isProd = process.env.NODE_ENV === "production";
    if (isProd && !required) {
      console.error("[WEBHOOK_SECURITY] WEBHOOK_TOKEN not configured in production");
      return res.status(500).json({
        ok: false,
        stage: "WEBHOOK_CONFIG_ERROR",
        message: "WEBHOOK_TOKEN_NOT_CONFIGURED",
      });
    }
    if (!required) return next();
    const got = req.headers["x-webhook-token"] || req.query.token || "";
    if (String(got) !== String(required)) return res.status(403).json({ ok: false, stage: "WEBHOOK_FORBIDDEN" });
    return next();
  }

  function parseBody(req) {
    const b = req.body;
    if (!b) return {};
    if (typeof b === "object") return b;
    if (typeof b === "string") {
      const s = b.trim();
      if (!s) return {};
      try {
        return JSON.parse(s);
      } catch (err) {
        console.warn("[WEBHOOK_PARSE_FAIL]", err?.message || err);
        return {};
      }
    }
    return {};
  }

  function pickPayloadValue(payload, keys = []) {
    if (!payload || typeof payload !== "object") return null;
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
      const value = payload[key];
      if (value !== undefined && value !== null) return value;
    }
    return null;
  }

  function toFiniteNumberOrNull(raw) {
    if (raw === null || raw === undefined || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  function clampNumber(value, minVal, maxVal) {
    if (!Number.isFinite(value)) return null;
    return Math.min(maxVal, Math.max(minVal, value));
  }

  function parseBooleanOrNull(raw) {
    if (raw === true || raw === false) return raw;
    if (raw === 1 || raw === "1") return true;
    if (raw === 0 || raw === "0") return false;
    const s = String(raw ?? "").trim().toLowerCase();
    if (!s) return null;
    if (["true", "t", "yes", "y", "on"].includes(s)) return true;
    if (["false", "f", "no", "n", "off"].includes(s)) return false;
    return null;
  }

  function normalizeTraceEmitMode(raw) {
    const s = String(raw ?? "").trim().toUpperCase();
    if (!s) return null;
    if (s === "BAR_CLOSE" || s === "REALTIME_PRE") return s;
    return s;
  }

  const WEBHOOK_RATE_LIMIT_WINDOW_MS = Number.isFinite(Number(process.env.WEBHOOK_RATE_LIMIT_WINDOW_MS))
    ? Number(process.env.WEBHOOK_RATE_LIMIT_WINDOW_MS)
    : 60 * 1000;
  const WEBHOOK_RATE_LIMIT_MAX = Number.isFinite(Number(process.env.WEBHOOK_RATE_LIMIT_MAX))
    ? Number(process.env.WEBHOOK_RATE_LIMIT_MAX)
    : 600;
  const WEBHOOK_JITTER_MS = Number.isFinite(Number(process.env.WEBHOOK_JITTER_MS))
    ? Math.max(0, Number(process.env.WEBHOOK_JITTER_MS))
    : 0;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function toFinitePositive(raw, fallback) {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  // Outer webhook timeout must be larger than AI inner timeout/retry window,
  // otherwise AI meta can be dropped and later converted to DROP_AI_MISSING.
  const AI_SIGNAL_TIMEOUT_MS = toFinitePositive(process.env.SIGNAL_AI_TIMEOUT_MS, 8000);
  const AI_SIGNAL_RETRY_MAX = Math.max(0, Math.trunc(toFinitePositive(process.env.SIGNAL_AI_RETRY_MAX, 2)));
  const AI_SIGNAL_RETRY_BASE_MS = Math.max(0, Math.trunc(toFinitePositive(process.env.SIGNAL_AI_RETRY_BASE_MS, 250)));
  const AI_RETRY_WAIT_SUM_MS = AI_SIGNAL_RETRY_BASE_MS * (AI_SIGNAL_RETRY_MAX * (AI_SIGNAL_RETRY_MAX + 1) / 2);
  const AI_EVAL_TIMEOUT_DEFAULT_MS = Math.max(
    12000,
    (AI_SIGNAL_TIMEOUT_MS * (AI_SIGNAL_RETRY_MAX + 1)) + AI_RETRY_WAIT_SUM_MS + 1500
  );
  const AI_EVAL_TIMEOUT_MS = toFinitePositive(process.env.AI_EVAL_TIMEOUT_MS, AI_EVAL_TIMEOUT_DEFAULT_MS);
  function withTimeout(promise, ms, fallback = null) {
    let timer;
    return Promise.race([
      promise,
      new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); }),
    ]).finally(() => clearTimeout(timer));
  }

  const webhookLimiter = rateLimit({
    windowMs: WEBHOOK_RATE_LIMIT_WINDOW_MS,
    max: WEBHOOK_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, stage: "RATE_LIMIT_EXCEEDED" },
  });

  router.post("/webhook/echo", webhookLimiter, checkToken, express.text({ type: "*/*", limit: "256kb" }), (req, res) => {
    const parsed = parseBody(req);
    return res.json({
      ok: true,
      headers: { "content-type": req.headers["content-type"] || null },
      body_type: typeof req.body,
      body_raw: req.body,
      body_parsed: parsed,
    });
  });

  const WEBHOOK_TRACE_ENABLED = String(process.env.WEBHOOK_TRACE_ENABLED || "1") === "1";
  const WEBHOOK_TRACE_SAMPLE = Number(process.env.WEBHOOK_TRACE_SAMPLE || "1");

  function shouldTrace() {
    if (!WEBHOOK_TRACE_ENABLED) return false;
    if (WEBHOOK_TRACE_SAMPLE >= 1) return true;
    if (WEBHOOK_TRACE_SAMPLE <= 0) return false;
    return Math.random() < WEBHOOK_TRACE_SAMPLE;
  }

  function emitWebhookTrace(enabled, payload) {
    if (!enabled) return;
    try {
      console.log("[WEBHOOK_TRACE_V1]", JSON.stringify(payload));
    } catch (_) {}
  }

  router.post("/webhook/signal", webhookLimiter, checkToken, express.text({ type: "*/*", limit: "256kb" }), async (req, res) => {
    const traceOn = shouldTrace();
    const requestId = buildWebhookRequestId();
    try {
      const p = parseBody(req);
      const rawBody = (typeof req.body === "string")
        ? req.body
        : (req.body == null ? "" : JSON.stringify(req.body));
      // fire-and-forget: 인그레스 기록을 기다리지 않음 (TradingView 타임아웃 방지)
      recordWebhookIngress({
        requestId,
        path: req.originalUrl || req.path || "/webhook/signal",
        method: req.method || "POST",
        headers: req.headers || {},
        rawBody,
        parsedBody: p,
      }).catch(e => console.warn("[WEBHOOK_LEDGER_INGRESS_FAIL]", e?.message || e));
      const finalize = ({ httpStatus = 200, body = {}, decision = null, reason = null, context = null } = {}) => {
        // 응답을 먼저 보내고, outcome 기록은 fire-and-forget (TradingView 타임아웃 방지)
        res.status(httpStatus).json(body);
        recordWebhookOutcome({
          requestId,
          httpStatus,
          decision,
          reason,
          detail: context || undefined,
          ...(context || {}),
        }).catch(e => console.warn("[WEBHOOK_LEDGER_OUTCOME_FAIL]", e?.message || e));
      };
      if (WEBHOOK_JITTER_MS > 0) {
        const waitMs = Math.floor(Math.random() * (WEBHOOK_JITTER_MS + 1));
        if (waitMs > 0) await sleep(waitMs);
      }

      const symbolRaw =
        p.symbol ||
        p.symbol_or_pair_id ||
        p.market ||
        p.market_id ||
        p.ticker ||
        p.tickerid ||
        p.code ||
        (p.features && (p.features.symbol || p.features.ticker || p.features.symbol_or_pair_id)) ||
        "";
      const inferredExchange = p.exchange ? "" : inferExchangeFromMarket(symbolRaw);
      const exchange = normalizeExchangeId(p.exchange || inferredExchange || "");
      const symbol = normalizeMarketSymbolForProvider(symbolRaw, exchange);
      const tfRaw = normalizeTf(p.tf);
      let tf = tfRaw;
      let executionMode = "PAPER";
      let systemSettings = {};
      try {
        const sys = await getSystemSettingsForProvider(exchange || "BINANCEFUT", 3000);
        systemSettings = (sys && sys.data && typeof sys.data === "object") ? sys.data : {};
        const rawMode = systemSettings.execution_mode;
        if (rawMode) executionMode = String(rawMode || "").toUpperCase();
      } catch (_) {}

      let barCloseUtcStr = p.bar_close_time_utc || p.barCloseTimeUtc || null;
      let barCloseMs = parseBarCloseMs(
        p.bar_close_time_utc_ms ?? p.barCloseTimeUtcMs ?? p.bar_close_ms,
        barCloseUtcStr,
        tf
      );
      barCloseMs = alignBarCloseMs(exchange, tf, barCloseMs);
      let tfAllowed = !!tf && await isAllowedTf(exchange, tf);
      if (!tfAllowed) {
        emitWebhookTrace(traceOn, {
          decision: "DROP",
          reason: "TF_NOT_ALLOWED",
          exchange,
          symbol,
          tf_raw: tfRaw,
          tf_final: tf,
          event: p.event || null,
          side: p.side || null,
          action: p.action || null,
          intent: null,
          qty_pct: Number(p.qtyPct ?? p.qty_pct ?? p.qty ?? p.qtyPercent ?? p.qty_percent ?? null),
          bar_close_time_utc_ms: barCloseMs,
          signal_id: p.signal_id || null,
        });
        return finalize({
          httpStatus: 202,
          body: { ok: true, dropped: true, reason: "TF_NOT_ALLOWED", tf: tfRaw },
          decision: "DROP",
          reason: "TF_NOT_ALLOWED",
          context: {
            exchange,
            symbol,
            tf: tfRaw,
            event: p.event || null,
            side: p.side || null,
            qtyPct: Number(p.qtyPct ?? p.qty_pct ?? p.qty ?? p.qtyPercent ?? p.qty_percent ?? null),
            signalId: p.signal_id || null,
            barCloseMs,
          },
        });
      }
      barCloseUtcStr = normalizeBarCloseUtc(barCloseUtcStr, barCloseMs, tf);

      const tfMs = tfToMs(tf);
      const queueEnabled = systemSettings.signal_queue_enabled !== false;
      const maxLateBars = Math.max(0, Number(systemSettings.signal_queue_max_late_bars ?? 1));
      const signalAgeMs = Number.isFinite(barCloseMs) ? (Date.now() - barCloseMs) : null;
      const signalLateBars = (Number.isFinite(signalAgeMs) && Number.isFinite(tfMs) && tfMs > 0)
        ? Math.floor(signalAgeMs / tfMs)
        : null;
      const tooOld = queueEnabled
        ? (Number.isFinite(signalLateBars) && signalLateBars > maxLateBars)
        : (Number.isFinite(signalLateBars) && signalLateBars > 0);
      if (tooOld) {
        await recordSignalDrops({
          exchange,
          symbol,
          tf,
          drops: [{
            event: p.event || null,
            side: p.side || null,
            bar_close_time_utc_ms: barCloseMs,
            qty_pct: Number(p.qtyPct ?? p.qty_pct ?? p.qty ?? p.qtyPercent ?? p.qty_percent ?? null),
            reason: "DROP_SIGNAL_TOO_OLD",
            execution_mode: executionMode,
            features_json: {
              ...(p.features || {}),
              _drop_signal_too_old: true,
              _signal_late_bars: signalLateBars,
              _signal_age_ms: signalAgeMs,
              _signal_queue_enabled: queueEnabled,
              _signal_queue_max_late_bars: maxLateBars,
            },
            event_group: "DROP",
            event_subtype: "DROP",
            drop_reason_code: "SIGNAL_TOO_OLD",
            signal_id: p.signal_id || null,
            event_intent: "DROP",
            mapping_ok: false,
            mapping_version: SIGNAL_MAPPING_VERSION,
          }],
        });
        emitWebhookTrace(traceOn, {
          decision: "DROP",
          reason: "SIGNAL_TOO_OLD",
          exchange,
          symbol,
          tf_raw: tfRaw,
          tf_final: tf,
          event: p.event || null,
          side: p.side || null,
          action: p.action || null,
          intent: "DROP",
          qty_pct: Number(p.qtyPct ?? p.qty_pct ?? p.qty ?? p.qtyPercent ?? p.qty_percent ?? null),
          bar_close_time_utc_ms: barCloseMs,
          signal_late_bars: signalLateBars,
          signal_id: p.signal_id || null,
        });
        fireSignalDroppedAlert({
          exchange,
          symbol,
          tf,
          event: p.event || null,
          side: p.side || null,
          qtyPct: Number(p.qtyPct ?? p.qty_pct ?? p.qty ?? p.qtyPercent ?? p.qty_percent ?? null),
          reason: "DROP_SIGNAL_TOO_OLD",
          dropReasonCode: "SIGNAL_TOO_OLD",
          signalId: p.signal_id || null,
          executionMode: executionMode,
          source: "WEBHOOK",
          authoritative: false,
        });
        return finalize({
          httpStatus: 202,
          body: {
            ok: true,
            dropped: true,
            reason: "SIGNAL_TOO_OLD",
            late_bars: signalLateBars,
            signal_id: p.signal_id || null,
          },
          decision: "DROP",
          reason: "SIGNAL_TOO_OLD",
          context: {
            exchange,
            symbol,
            tf,
            event: p.event || null,
            side: p.side || null,
            qtyPct: Number(p.qtyPct ?? p.qty_pct ?? p.qty ?? p.qtyPercent ?? p.qty_percent ?? null),
            signalId: p.signal_id || null,
            barCloseMs,
            signalLateBars,
            maxLateBars,
          },
        });
      }

      const actionRaw = p.action || p.event_intent || p.intent || "";
      const action = String(actionRaw || "").trim().toUpperCase();
      let actionFinal = action;
      const actionIntent = actionFinal === "ENTRY" || actionFinal === "ADD" || actionFinal === "EXIT" ? actionFinal : null;
      let actionIntentFinal = actionIntent;
      let isDrop = actionFinal === "DROP";

      let allowedMarkets = [];
      let exchangeEnabled = true;
      try {
        const exchangeCfg = await getExchangeSettingsForProvider(exchange || "BINANCEFUT", 2000);
        exchangeEnabled = !(exchangeCfg && exchangeCfg.enabled === false);
        allowedMarkets = normalizeMarketsList(exchangeCfg && exchangeCfg.markets ? exchangeCfg.markets : [], exchange);
      } catch (_) {
        allowedMarkets = [];
        exchangeEnabled = true;
      }

      if (symbol) {
        if (!exchangeEnabled) {
          await recordSignalDrops({
            exchange,
            symbol,
            tf,
            drops: [{
              event: p.event || null,
              side: p.side || null,
              bar_close_time_utc_ms: barCloseMs,
              qty_pct: Number(p.qtyPct ?? p.qty_pct ?? p.qty ?? p.qtyPercent ?? p.qty_percent ?? null),
              reason: "DROP_EXCHANGE_DISABLED",
              execution_mode: executionMode,
              features_json: {
                ...(p.features || {}),
                _drop_exchange_disabled: true,
              },
              event_group: "DROP",
              event_subtype: "DROP",
              drop_reason_code: "EXCHANGE_DISABLED",
              signal_id: p.signal_id || null,
              event_intent: "DROP",
              mapping_ok: false,
              mapping_version: SIGNAL_MAPPING_VERSION,
            }],
          });
          emitWebhookTrace(traceOn, {
            decision: "DROP",
            reason: "EXCHANGE_DISABLED",
            exchange,
            symbol,
            tf_raw: tfRaw,
            tf_final: tf,
            event: p.event || null,
            side: p.side || null,
            action: p.action || null,
            intent: "DROP",
            qty_pct: Number(p.qtyPct ?? p.qty_pct ?? p.qty ?? p.qtyPercent ?? p.qty_percent ?? null),
            bar_close_time_utc_ms: barCloseMs,
            signal_id: p.signal_id || null,
          });
          return finalize({
            httpStatus: 202,
            body: { ok: true, dropped: true, reason: "EXCHANGE_DISABLED", signal_id: p.signal_id || null },
            decision: "DROP",
            reason: "EXCHANGE_DISABLED",
            context: {
              exchange,
              symbol,
              tf,
              event: p.event || null,
              side: p.side || null,
              qtyPct: Number(p.qtyPct ?? p.qty_pct ?? p.qty ?? p.qtyPercent ?? p.qty_percent ?? null),
              signalId: p.signal_id || null,
              barCloseMs,
            },
          });
        }
        const marketAllowed = !allowedMarkets.length || allowedMarkets.includes(symbol);
        if (!marketAllowed && !WEBHOOK_AUTO_REGISTER_MARKET) {
          await recordSignalDrops({
            exchange,
            symbol,
            tf,
            drops: [{
              event: p.event || null,
              side: p.side || null,
              bar_close_time_utc_ms: barCloseMs,
              qty_pct: Number(p.qtyPct ?? p.qty_pct ?? p.qty ?? p.qtyPercent ?? p.qty_percent ?? null),
              reason: "DROP_MARKET_NOT_ENABLED",
              execution_mode: executionMode,
              features_json: {
                ...(p.features || {}),
                _drop_market_not_enabled: true,
                _allowed_markets_n: allowedMarkets.length,
              },
              event_group: "DROP",
              event_subtype: "DROP",
              drop_reason_code: "MARKET_NOT_ENABLED",
              signal_id: p.signal_id || null,
              event_intent: "DROP",
              mapping_ok: false,
              mapping_version: SIGNAL_MAPPING_VERSION,
            }],
          });
          emitWebhookTrace(traceOn, {
            decision: "DROP",
            reason: "MARKET_NOT_ENABLED",
            exchange,
            symbol,
            tf_raw: tfRaw,
            tf_final: tf,
            event: p.event || null,
            side: p.side || null,
            action: p.action || null,
            intent: "DROP",
            qty_pct: Number(p.qtyPct ?? p.qty_pct ?? p.qty ?? p.qtyPercent ?? p.qty_percent ?? null),
            bar_close_time_utc_ms: barCloseMs,
            signal_id: p.signal_id || null,
          });
          return finalize({
            httpStatus: 202,
            body: { ok: true, dropped: true, reason: "MARKET_NOT_ENABLED", signal_id: p.signal_id || null },
            decision: "DROP",
            reason: "MARKET_NOT_ENABLED",
            context: {
              exchange,
              symbol,
              tf,
              event: p.event || null,
              side: p.side || null,
              qtyPct: Number(p.qtyPct ?? p.qty_pct ?? p.qty ?? p.qtyPercent ?? p.qty_percent ?? null),
              signalId: p.signal_id || null,
              barCloseMs,
            },
          });
        }
        if (!marketAllowed && WEBHOOK_AUTO_REGISTER_MARKET) {
          await ensureMarketRegistered(exchange, symbol);
        }
      }

      const eventRaw = p.event;
      let eventFinal = normalizeTpP1EventForExchange(eventRaw, exchange);
      let exitCandidate = actionIntentFinal === "EXIT" || isExitLikeEvent(eventFinal);
      let sideCandidate = p.side;
      let pos = null;
      if (exitCandidate) {
        pos = await getPosition({ exchange, symbol });
        const posState = String(pos.state || "").toUpperCase();
        const posSize = Number(pos.size_pct || 0);
        if (posState !== "ACTIVE" || !Number.isFinite(posSize) || posSize <= 0) {
          if (isExitAllEvent(eventFinal) && !isSpotExchange(exchange) && WEBHOOK_EXIT_ALL_RECAST_TO_SHORT) {
            eventFinal = "SHORT";
            actionIntentFinal = "ENTRY";
            actionFinal = "ENTRY";
            isDrop = false;
            sideCandidate = "SELL";
            exitCandidate = false;
            if (!p.features) p.features = {};
            p.features._exit_all_recast = true;
            p.features._exit_all_recast_to = "SHORT";
            p.features._action_raw = action;
            p.features.action = "ENTRY";
          } else {
          await recordSignalDrops({
            exchange,
            symbol,
            tf,
            drops: [{
              event: eventFinal,
              side: sideCandidate,
              bar_close_time_utc_ms: barCloseMs,
              qty_pct: Number(p.qtyPct ?? p.qty_pct ?? p.qty ?? p.qtyPercent ?? p.qty_percent ?? null),
              reason: "DROP_NO_POSITION_EXIT",
              execution_mode: executionMode,
              features_json: {
                ...(p.features || {}),
                _drop_no_position_exit: true,
                _pos_state_actual: posState || null,
                _pos_size_pct: Number.isFinite(posSize) ? posSize : null,
                _pos_active: posState === "ACTIVE" && Number.isFinite(posSize) && posSize > 0,
              },
              event_group: "EXIT",
              event_subtype: "EXIT",
              drop_reason_code: "NO_POSITION_EXIT",
              signal_id: p.signal_id || null,
              event_intent: "EXIT",
              mapping_ok: false,
              mapping_version: SIGNAL_MAPPING_VERSION,
            }],
          });
          emitWebhookTrace(traceOn, {
            decision: "DROP",
            reason: "NO_POSITION_EXIT",
            exchange,
            symbol,
            tf_raw: tfRaw,
            tf_final: tf,
            event: eventFinal,
            side: sideCandidate || null,
            action: actionFinal,
            intent: "EXIT",
            qty_pct: Number(p.qtyPct ?? p.qty_pct ?? p.qty ?? p.qtyPercent ?? p.qty_percent ?? null),
            bar_close_time_utc_ms: barCloseMs,
            mapping_ok: false,
            exchange_side_allowed: true,
            signal_id: p.signal_id || null,
          });
          return finalize({
            body: { ok: true, dropped: true, reason: "NO_POSITION_EXIT", signal_id: p.signal_id || null },
            decision: "DROP",
            reason: "NO_POSITION_EXIT",
            context: {
              exchange,
              symbol,
              tf,
              event: eventFinal,
              side: sideCandidate || null,
              action: actionFinal || null,
              intent: "EXIT",
              qtyPct: Number(p.qtyPct ?? p.qty_pct ?? p.qty ?? p.qtyPercent ?? p.qty_percent ?? null),
              signalId: p.signal_id || null,
              barCloseMs,
              mappingOk: false,
              exchangeSideAllowed: true,
            },
          });
          }
        }

        if (exitCandidate) {
          const posSide = String(pos.position_side || pos.positionSide || pos.side || "LONG").toUpperCase();
          if (isExitAllEvent(eventFinal)) {
            await recordSignalDrops({
              exchange,
              symbol,
              tf,
              drops: [{
                event: eventFinal,
                side: sideCandidate,
                bar_close_time_utc_ms: barCloseMs,
                qty_pct: Number(p.qtyPct ?? p.qty_pct ?? p.qty ?? p.qtyPercent ?? p.qty_percent ?? null),
                reason: "DROP_EXIT_ALL_EXTERNAL_ONLY",
                execution_mode: executionMode,
                features_json: {
                  ...(p.features || {}),
                  _drop_exit_all_external_only: true,
                  _pos_side_actual: posSide,
                  _pos_size_pct: Number.isFinite(posSize) ? posSize : null,
                },
                event_group: "EXIT",
                event_subtype: "EXIT",
                drop_reason_code: "EXIT_ALL_BLOCKED_EXTERNAL_ONLY",
                signal_id: p.signal_id || null,
                event_intent: "EXIT",
                mapping_ok: false,
                mapping_version: SIGNAL_MAPPING_VERSION,
              }],
            });
            emitWebhookTrace(traceOn, {
              decision: "DROP",
              reason: "EXIT_ALL_BLOCKED_EXTERNAL_ONLY",
              exchange,
              symbol,
              tf_raw: tfRaw,
              tf_final: tf,
              event: eventFinal,
              side: sideCandidate || null,
              action: actionFinal,
              intent: "EXIT",
              qty_pct: Number(p.qtyPct ?? p.qty_pct ?? p.qty ?? p.qtyPercent ?? p.qty_percent ?? null),
              bar_close_time_utc_ms: barCloseMs,
              mapping_ok: false,
              exchange_side_allowed: true,
              signal_id: p.signal_id || null,
            });
            return finalize({
              body: { ok: true, dropped: true, reason: "EXIT_ALL_BLOCKED_EXTERNAL_ONLY", signal_id: p.signal_id || null },
              decision: "DROP",
              reason: "EXIT_ALL_BLOCKED_EXTERNAL_ONLY",
              context: {
                exchange,
                symbol,
                tf,
                event: eventFinal,
                side: sideCandidate || null,
                action: actionFinal || null,
                intent: "EXIT",
                qtyPct: Number(p.qtyPct ?? p.qty_pct ?? p.qty ?? p.qtyPercent ?? p.qty_percent ?? null),
                signalId: p.signal_id || null,
                barCloseMs,
                mappingOk: false,
                exchangeSideAllowed: true,
              },
            });
          }
          if (exchange === "BINANCEFUT") {
            sideCandidate = posSide === "SHORT" ? "BUY" : "SELL";
          }
        }
      }

      const canonicalEntryEvent = canonicalExternalEntryEvent(eventFinal, sideCandidate);
      if (canonicalEntryEvent) eventFinal = canonicalEntryEvent;

      const mapping = resolveEventMapping({ event: eventFinal, side: sideCandidate });
      const event = mapping.event;
      const side = mapping.side;
      const eventUpper = String(event || "").trim().toUpperCase();
      const actionIntentRaw = actionIntentFinal;
      const intentBeforeOverride = actionIntentFinal || mapping.intent;
      let intent = intentBeforeOverride;
      const reasonRaw = p.reason ?? null;
      let posSnap = null;
      let intentOverrideReason = null;
      let reverseExceptionDetail = null;
      const featureObj = (p.features && typeof p.features === "object") ? p.features : {};
      const featureJsonObj = (p.features_json && typeof p.features_json === "object") ? p.features_json : {};
      const entryTimingTier = resolveEntryTimingTier({ event: eventUpper, features_json: featureObj });
      const isEarlyEvent = entryTimingTier === "EARLY";
      const priceRaw = p.price ?? p.last ?? p.close ?? p.current_price ?? p.cur_price ?? null;
      const price = (priceRaw === null || priceRaw === undefined || priceRaw === "") ? null : Number(priceRaw);
      if (!isDrop && (intent === "ENTRY" || intent === "ADD")) {
        if (!pos) {
          pos = await getPosition({ exchange, symbol });
        }
        posSnap = normalizePositionSnapshot(pos);
        const normalized = normalizeEntryIntentWithPosition({ intent, side, posSnap });
        if (normalized.reason) {
          intentOverrideReason = normalized.reason;
          intent = normalized.intent;
          actionIntentFinal = intent;
          actionFinal = intent;
        }
      }
      if (
        isDrop &&
        isStaleAddDropReason(reasonRaw) &&
        (intentBeforeOverride === "ENTRY" || intentBeforeOverride === "ADD")
      ) {
        if (!pos) {
          pos = await getPosition({ exchange, symbol });
        }
        if (!posSnap) {
          posSnap = normalizePositionSnapshot(pos);
        }
        if (!posSnap.active) {
          const pineBundle = resolvePineStage1BundleMeta(featureObj);
          if (pineBundle.semanticReject) {
            intentOverrideReason = "DROP_PINE_STAGE1_QUALITY_REJECT";
          } else {
            const normalized = normalizeEntryIntentWithPosition({ intent: intentBeforeOverride, side, posSnap });
            intent = normalized.intent === "ADD" ? "ENTRY" : (normalized.intent || "ENTRY");
            actionFinal = intent;
            actionIntentFinal = intent;
            isDrop = false;
            intentOverrideReason = normalized.reason || "PINE_DROP_STALE_POS_TO_ENTRY";
          }
        }
      }
      if (
        isDrop &&
        isReverseDropReason(reasonRaw) &&
        (intentBeforeOverride === "ENTRY" || intentBeforeOverride === "ADD")
      ) {
        if (!pos) {
          pos = await getPosition({ exchange, symbol });
        }
        if (!posSnap) {
          posSnap = normalizePositionSnapshot(pos);
        }
        const intentDir = sideToPositionDir(side);
        const oppositeDir = !!(posSnap && posSnap.active && posSnap.side && intentDir && posSnap.side !== intentDir);
        if (oppositeDir) {
          const sysRes = await getSystemSettingsForProvider(exchange, 5000);
          const reverseCfg = resolveReverseExceptionConfig(sysRes && sysRes.data ? sysRes.data : {}, exchange);
          if (reverseCfg.enabled === true && isReverseExceptionTierEvent(event, reverseCfg)) {
            const entryExecBarMs = Number(pos && pos.meta && pos.meta.entry_exec_bar_ms);
            const rows = await loadRecentDroppedSignalsSince(entryExecBarMs, 300);
            const reverseDropState = summarizeOppositeReverseDrops({
              rows,
              exchange,
              symbol,
              tf,
              entryExecBarMs,
              incomingDir: intentDir,
              currentSignalId: p.signal_id || null,
              cfg: reverseCfg,
            });
            const livePnlState = exchange === "BINANCEFUT"
              ? await resolveLiveBinancePositionPnlPct(symbol)
              : { ok: false, reason: "REVERSE_EXCEPTION_EXCHANGE_UNSUPPORTED" };
            const reverseRevive = shouldReviveReverseDrop({
              cfg: reverseCfg,
              reasonRaw,
              intentBeforeOverride,
              posSnap,
              event,
              side,
              priorDropCount: reverseDropState.count,
              effectivePnlPct: livePnlState && livePnlState.ok ? livePnlState.pnlPct : null,
            });
            if (reverseRevive.ok) {
              intent = "ENTRY";
              actionFinal = "ENTRY";
              actionIntentFinal = "ENTRY";
              isDrop = false;
              intentOverrideReason = "SERVER_REVERSE_DROP_TO_ENTRY";
              reverseExceptionDetail = {
                ...(reverseRevive.detail || {}),
                raw_reason: normalizeReasonCode(reasonRaw),
                matched_drop_count: reverseDropState.count,
                matched_signal_ids: reverseDropState.matches.slice(0, 5).map((row) => row.signal_id).filter(Boolean),
                pnl_source: livePnlState && livePnlState.ok ? "BINANCE_LIVE" : (livePnlState && livePnlState.reason ? livePnlState.reason : null),
                live_pnl_detail: livePnlState && livePnlState.detail ? livePnlState.detail : null,
              };
            }
          }
        }
      }
      if (isDrop) {
        // Preserve Pine's explicit DROP action; do not rewrite to ENTRY/ADD via position normalization.
        actionFinal = "DROP";
        actionIntentFinal = "DROP";
        intent = "DROP";
      }
      const qtyPctRaw = pickPayloadValue(p, ["qtyPct", "qty_pct", "qty", "qtyPercent", "qty_percent"]);
      const qtyPctParsed = toFiniteNumberOrNull(qtyPctRaw);
      const qtyPct = Number.isFinite(qtyPctParsed) ? clampNumber(qtyPctParsed, 0, 1) : null;
      const qtyPctWasClamped = Number.isFinite(qtyPctParsed) && qtyPct !== qtyPctParsed;
      const qtySanitizedSource = pickPayloadValue(p, ["qty_sanitized", "qtySanitized"])
        ?? pickPayloadValue(featureObj, ["qty_sanitized", "qtySanitized"]);
      const qtySanitized = parseBooleanOrNull(qtySanitizedSource);

      const tracePayloadVersionSource = pickPayloadValue(p, ["trace_payload_version", "tracePayloadVersion"])
        ?? pickPayloadValue(featureObj, ["trace_payload_version", "tracePayloadVersion"]);
      const tracePayloadVersion = tracePayloadVersionSource == null
        ? null
        : (String(tracePayloadVersionSource).trim() || null);

      const traceEmitModeSource = pickPayloadValue(p, ["trace_emit_mode", "traceEmitMode"])
        ?? pickPayloadValue(featureObj, ["trace_emit_mode", "traceEmitMode"]);
      const traceEmitMode = normalizeTraceEmitMode(traceEmitModeSource);

      const traceChainKeySource = pickPayloadValue(p, ["trace_chain_key", "traceChainKey"])
        ?? pickPayloadValue(featureObj, ["trace_chain_key", "traceChainKey"]);
      const traceChainKey = traceChainKeySource == null
        ? null
        : (String(traceChainKeySource).trim() || null);

      const costShieldEnableSource = pickPayloadValue(p, ["cost_shield_enable", "costShieldEnable"])
        ?? pickPayloadValue(featureObj, ["cost_shield_enable", "costShieldEnable"]);
      const costShieldEnable = parseBooleanOrNull(costShieldEnableSource);

      const costShieldEntryMultSource = pickPayloadValue(p, ["cost_shield_entry_mult", "costShieldEntryMult"])
        ?? pickPayloadValue(featureObj, ["cost_shield_entry_mult", "costShieldEntryMult"]);
      const costShieldEntryMultParsed = toFiniteNumberOrNull(costShieldEntryMultSource);
      const costShieldEntryMult = Number.isFinite(costShieldEntryMultParsed)
        ? clampNumber(costShieldEntryMultParsed, 0, 1)
        : null;

      const costShieldBlockAddSource = pickPayloadValue(p, ["cost_shield_block_add", "costShieldBlockAdd"])
        ?? pickPayloadValue(featureObj, ["cost_shield_block_add", "costShieldBlockAdd"]);
      const costShieldBlockAdd = parseBooleanOrNull(costShieldBlockAddSource);

      const costShieldGapMultSource = pickPayloadValue(p, ["cost_shield_gap_mult", "costShieldGapMult"])
        ?? pickPayloadValue(featureObj, ["cost_shield_gap_mult", "costShieldGapMult"]);
      const costShieldGapMultParsed = toFiniteNumberOrNull(costShieldGapMultSource);
      const costShieldGapMult = Number.isFinite(costShieldGapMultParsed)
        ? clampNumber(costShieldGapMultParsed, 1, 3)
        : null;

      // Exit Policy (Pine override: ATR_DYNAMIC / PINE_FIXED):
      const exitPolicySourceRaw = pickPayloadValue(p, ["exit_policy_source", "exitPolicySource"])
        ?? pickPayloadValue(featureObj, ["exit_policy_source", "exitPolicySource"]);
      const exitPolicySource = exitPolicySourceRaw == null
        ? null
        : (() => {
          const v = String(exitPolicySourceRaw).trim().toUpperCase();
          return (v === "ATR_DYNAMIC" || v === "PINE_FIXED" || v === "BINANCE_DEFAULT") ? v : null;
        })();

      const exitPolicyTp1PctSource = pickPayloadValue(p, ["exit_policy_tp1_pct", "exitPolicyTp1Pct"])
        ?? pickPayloadValue(featureObj, ["exit_policy_tp1_pct", "exitPolicyTp1Pct"]);
      const exitPolicyTp1PctParsed = toFiniteNumberOrNull(exitPolicyTp1PctSource);
      const exitPolicyTp1Pct = Number.isFinite(exitPolicyTp1PctParsed)
        ? clampNumber(exitPolicyTp1PctParsed, 0.5, 15)
        : null;

      const exitPolicySlPctSource = pickPayloadValue(p, ["exit_policy_sl_pct", "exitPolicySlPct"])
        ?? pickPayloadValue(featureObj, ["exit_policy_sl_pct", "exitPolicySlPct"]);
      const exitPolicySlPctParsed = toFiniteNumberOrNull(exitPolicySlPctSource);
      const exitPolicySlPct = Number.isFinite(exitPolicySlPctParsed)
        ? clampNumber(exitPolicySlPctParsed, 0.5, 15)
        : null;

      const exitPolicyTrailPctSource = pickPayloadValue(p, ["exit_policy_trail_pct", "exitPolicyTrailPct"])
        ?? pickPayloadValue(featureObj, ["exit_policy_trail_pct", "exitPolicyTrailPct"]);
      const exitPolicyTrailPctParsed = toFiniteNumberOrNull(exitPolicyTrailPctSource);
      const exitPolicyTrailPct = Number.isFinite(exitPolicyTrailPctParsed)
        ? clampNumber(exitPolicyTrailPctParsed, 0.3, 5)
        : null;

      const exitPolicyBePctSource = pickPayloadValue(p, ["exit_policy_be_pct", "exitPolicyBePct"])
        ?? pickPayloadValue(featureObj, ["exit_policy_be_pct", "exitPolicyBePct"]);
      const exitPolicyBePctParsed = toFiniteNumberOrNull(exitPolicyBePctSource);
      const exitPolicyBePct = Number.isFinite(exitPolicyBePctParsed)
        ? clampNumber(exitPolicyBePctParsed, 0, 5)
        : null;

      const exitPolicyRunnerMinProfitPctSource = pickPayloadValue(p, ["exit_policy_runner_min_profit_pct", "exitPolicyRunnerMinProfitPct", "exit_policy_runner_floor_pct", "exitPolicyRunnerFloorPct"])
        ?? pickPayloadValue(featureObj, ["exit_policy_runner_min_profit_pct", "exitPolicyRunnerMinProfitPct", "exit_policy_runner_floor_pct", "exitPolicyRunnerFloorPct"]);
      const exitPolicyRunnerMinProfitPctParsed = toFiniteNumberOrNull(exitPolicyRunnerMinProfitPctSource);
      const exitPolicyRunnerMinProfitPct = Number.isFinite(exitPolicyRunnerMinProfitPctParsed)
        ? clampNumber(exitPolicyRunnerMinProfitPctParsed, 0.5, 10)
        : null;

      const strategyGate = await resolveRuntimeStrategyGate();
      const strategyIdentity = resolvePayloadStrategyIdentity({
        payload: p,
        featureObj,
        featureJsonObj,
        defaultStrategyId: strategyGate.defaultStrategyId,
      });
      const strategyIdPresent = strategyIdentity.present === true;
      const strategyId = strategyIdentity.effectiveStrategyId;
      const strategyAllowed = !WEBHOOK_STRATEGY_GATE_ENABLED || strategyGate.allowedStrategySet.size === 0
        ? true
        : strategyGate.allowedStrategySet.has(strategyId);
      const strategyMissingBlocked = WEBHOOK_STRATEGY_GATE_ENABLED && WEBHOOK_STRATEGY_REQUIRE_ID && !strategyIdPresent;
      const strategyMismatchBlocked = WEBHOOK_STRATEGY_GATE_ENABLED && !strategyAllowed;
      const confidenceRaw = p.confidence ?? p.signal_confidence ?? p.conf ?? null;
      const confidence = (confidenceRaw === null || confidenceRaw === undefined || confidenceRaw === "") ? null : Number(confidenceRaw);
      const accountBalanceRaw = p.account_balance ?? p.accountBalance ?? null;
      const accountBalance = (accountBalanceRaw === null || accountBalanceRaw === undefined || accountBalanceRaw === "") ? null : Number(accountBalanceRaw);
      let currentPosition = p.current_position ?? p.currentPosition ?? null;
      if (pos) currentPosition = pos;
      const riskConfig = p.risk_config ?? p.riskConfig ?? null;

      const { group: derivedGroup, subtype } = deriveGroupSubtype(event);
      const group = isDrop ? "DROP" : (actionIntentFinal || mapping.intent || derivedGroup);
      const groupAllowed = group === "ENTRY" || group === "ADD" || group === "EXIT" || isDrop;
      const sideAllowed = side === "BUY" || side === "SELL";
      const exchangeSideAllowed = isDrop ? true : allowSideByExchange({ exchange, intent, side });

      if (strategyMissingBlocked || strategyMismatchBlocked) {
        const reasonCode = strategyMissingBlocked ? "STRATEGY_ID_MISSING" : "STRATEGY_ID_MISMATCH";
        const reasonText = strategyMissingBlocked ? "DROP_STRATEGY_ID_MISSING" : "DROP_STRATEGY_ID_MISMATCH";
        await recordSignalDrops({
          exchange,
          symbol,
          tf,
          drops: [{
            event,
            side,
            bar_close_time_utc_ms: barCloseMs,
            qty_pct: qtyPct,
            reason: reasonText,
            execution_mode: executionMode,
            features_json: {
              ...(p.features || {}),
              _drop_strategy_gate: true,
              _strategy_gate_enabled: WEBHOOK_STRATEGY_GATE_ENABLED,
              _strategy_required: WEBHOOK_STRATEGY_REQUIRE_ID,
              _strategy_id_present: strategyIdPresent,
              _strategy_id_received: strategyIdPresent ? strategyId : null,
              _strategy_id_canonical_received: strategyIdentity.canonicalId,
              _strategy_id_alias_received: strategyIdentity.aliasId,
              _strategy_id_default: strategyGate.defaultStrategyId,
              _strategy_allowed_ids: strategyGate.allowedStrategyIds,
              _strategy_gate_source: strategyGate.source,
            },
            event_group: "DROP",
            event_subtype: "DROP",
            drop_reason_code: reasonCode,
            signal_id: p.signal_id || null,
            event_intent: "DROP",
            mapping_ok: mapping.ok === true,
            mapping_version: SIGNAL_MAPPING_VERSION,
          }],
        });
        emitWebhookTrace(traceOn, {
          decision: "DROP",
          reason: reasonCode,
          exchange,
          symbol,
          tf_raw: tfRaw,
          tf_final: tf,
          event,
          side,
          action: actionFinal,
          intent: "DROP",
          qty_pct: qtyPct,
          bar_close_time_utc_ms: barCloseMs,
          strategy_id: strategyId,
          signal_id: p.signal_id || null,
        });
        fireSignalDroppedAlert({
          exchange,
          symbol,
          tf,
          event,
          side,
          qtyPct,
          reason: reasonText,
          dropReasonCode: reasonCode,
          signalId: p.signal_id || null,
          executionMode: executionMode,
          source: "WEBHOOK",
          authoritative: false,
        });
        persistWebhookSignalExecutionProbe({
          requestId,
          exchange,
          symbol,
          tf,
          signalId: p.signal_id || null,
          phase: "DROP_STRATEGY_GATE",
          saved: false,
          summary: {
            status: reasonCode,
            detail: {
              strategy_id_received: strategyIdPresent ? strategyId : null,
              strategy_id_present: strategyIdPresent,
              strategy_default_id: strategyGate.defaultStrategyId,
              strategy_allowed_ids: strategyGate.allowedStrategyIds,
              strategy_gate_source: strategyGate.source,
              mapping_ok: mapping.ok === true,
              event,
              side,
              execution_mode: executionMode || null,
            },
          },
        });
        return finalize({
          httpStatus: 202,
          body: {
            ok: true,
            dropped: true,
            reason: reasonCode,
            strategy_id: strategyId,
            signal_id: p.signal_id || null,
          },
          decision: "DROP",
          reason: reasonCode,
          context: {
            exchange,
            symbol,
            tf,
            event,
            side,
            action: actionFinal || null,
            intent: "DROP",
            qtyPct,
            signalId: p.signal_id || null,
            barCloseMs,
            strategyId,
          },
        });
      }

      const hasRequired = !!exchange
        && !!symbol
        && !!tf
        && tfAllowed
        && Number.isFinite(barCloseMs)
        && !!event
        && sideAllowed
        && groupAllowed
        && mapping.ok
        && exchangeSideAllowed
        && qtyPct !== null
        && Number.isFinite(qtyPct)
        && qtyPct > 0;
      if (!hasRequired) {
        try {
          console.log("[WEBHOOK_BAD_REQUEST_LOG_V3]", JSON.stringify({
            headers: {
              "user-agent": req.headers["user-agent"] || null,
              "content-type": req.headers["content-type"] || null,
            },
            parsed: { exchange, symbol, tf, tfAllowed, barCloseMs, event, side, group, subtype, qtyPct, intent, exchangeSideAllowed, mapping },
            raw_body_type: typeof req.body,
            raw_body: req.body,
            parsed_body: p,
          }));
        } catch (err) {
          console.warn("[WEBHOOK_BAD_REQUEST_LOG_FAIL]", err?.message || err);
        }
        emitWebhookTrace(traceOn, {
          decision: "BAD_REQUEST",
          exchange,
          symbol,
          tf_raw: tfRaw,
          tf_final: tf,
          event,
          side,
          action: actionFinal,
          intent,
          qty_pct: qtyPct,
          bar_close_time_utc_ms: barCloseMs,
          mapping_ok: mapping.ok === true,
          exchange_side_allowed: exchangeSideAllowed,
          signal_id: p.signal_id || null,
        });

        return finalize({
          httpStatus: 400,
          body: {
            ok: false,
            stage: "WEBHOOK_BAD_REQUEST",
            parsed: { exchange, symbol, tf, tfAllowed, barCloseMs, event, side, group, subtype, qtyPct, intent, exchangeSideAllowed, mapping },
            raw_body_type: typeof req.body,
            raw_body: req.body,
            parsed_body: p,
          },
          decision: "BAD_REQUEST",
          reason: "WEBHOOK_BAD_REQUEST",
          context: {
            exchange,
            symbol,
            tf,
            event,
            side,
            action: actionFinal || null,
            intent: intent || null,
            qtyPct,
            signalId: p.signal_id || null,
            barCloseMs,
            mappingOk: mapping.ok === true,
            exchangeSideAllowed,
          },
        });
      }

      let reason = "TV_WEBHOOK";
      if (intentOverrideReason) {
        reason = intentOverrideReason;
      } else if (posSnap && posSnap.active) {
        const intentDir = sideToPositionDir(side);
        const oppositeDir = intentDir && posSnap.side && posSnap.side !== intentDir;
        if ((intent === "ENTRY" || intent === "ADD") && oppositeDir) {
          reason = "POS_ACTIVE_OPPOSITE_DIR";
        }
      }
      const features = {
        ...(p.features || {}),
        _action_raw: action || null,
        _event_group: group,
        _event_subtype: subtype,
        _event_intent: isDrop ? "DROP" : intent,
        _event_mapping_version: SIGNAL_MAPPING_VERSION,
        _tf_raw: tfRaw,
        _tf_final: tf,
        _tf_upgraded: tfRaw !== tf,
        _execution_mode: executionMode,
      };
      const febtPayloadContract = mergeFebtPayloadContract({ payload: p, features });
      Object.assign(features, febtPayloadContract.features);
      const febtShadow = resolveFebtShadow(features);
      features.febt_payload_missing = febtShadow.payloadMissing === true;
      if (!features.febt_mode && febtShadow.mode) features.febt_mode = febtShadow.mode;
      if (!features.febt_phase && febtShadow.phase) features.febt_phase = febtShadow.phase;
      if (features.febt_calc_ok == null && febtShadow.calcOk !== null) features.febt_calc_ok = febtShadow.calcOk;
      if (!features.febt_calc_reason && febtShadow.calcReason) features.febt_calc_reason = febtShadow.calcReason;
      if (!features.febt_timing_action && febtShadow.timingAction) features.febt_timing_action = febtShadow.timingAction;
      if (!features.febt_authority && febtShadow.authority) features.febt_authority = febtShadow.authority;
      if (features.febt_state_valid == null && febtShadow.stateValid !== null) features.febt_state_valid = febtShadow.stateValid;
      if (!Number.isFinite(Number(features.febt_lock_score)) && Number.isFinite(febtShadow.lockScore)) features.febt_lock_score = febtShadow.lockScore;
      if (!Number.isFinite(Number(features.febt_delay_cost)) && Number.isFinite(febtShadow.delayCost)) features.febt_delay_cost = febtShadow.delayCost;
      if (!Number.isFinite(Number(features.febt_late_risk)) && Number.isFinite(febtShadow.lateRisk)) features.febt_late_risk = febtShadow.lateRisk;
      if (!Number.isFinite(Number(features.febt_failure_risk)) && Number.isFinite(febtShadow.failureRisk)) features.febt_failure_risk = febtShadow.failureRisk;
      if (!Number.isFinite(Number(features.febt_edge)) && Number.isFinite(febtShadow.edge)) features.febt_edge = febtShadow.edge;
      if (!Number.isFinite(Number(features.febt_same_dir_streak)) && Number.isFinite(febtShadow.sameDirStreak)) features.febt_same_dir_streak = febtShadow.sameDirStreak;
      if (!Number.isFinite(Number(features.febt_recent_move_1_pct)) && Number.isFinite(febtShadow.recentMove1Pct)) features.febt_recent_move_1_pct = febtShadow.recentMove1Pct;
      if (!Number.isFinite(Number(features.febt_recent_move_2_pct)) && Number.isFinite(febtShadow.recentMove2Pct)) features.febt_recent_move_2_pct = febtShadow.recentMove2Pct;
      if (!Number.isFinite(Number(features.febt_break_retention)) && Number.isFinite(febtShadow.breakRetention)) features.febt_break_retention = febtShadow.breakRetention;
      if (!Number.isFinite(Number(features.febt_close_control)) && Number.isFinite(febtShadow.closeControl)) features.febt_close_control = febtShadow.closeControl;
      if (!Number.isFinite(Number(features.febt_impulse_decay)) && Number.isFinite(febtShadow.impulseDecay)) features.febt_impulse_decay = febtShadow.impulseDecay;
      if (!Number.isFinite(Number(features.febt_counter_rejection)) && Number.isFinite(febtShadow.counterRejection)) features.febt_counter_rejection = febtShadow.counterRejection;
      if (!Number.isFinite(Number(features.febt_micro_absorption)) && Number.isFinite(febtShadow.microAbsorption)) features.febt_micro_absorption = febtShadow.microAbsorption;
      if (posSnap) {
        features._pos_active = posSnap.active;
        if (posSnap.side) features._pos_side = posSnap.side;
        if (Number.isFinite(posSnap.size_pct)) features._pos_size_pct = posSnap.size_pct;
      }
      if (intentOverrideReason) {
        features._intent_override_from = intentBeforeOverride || null;
        features._intent_override_to = intent;
        features._intent_override_reason = intentOverrideReason;
        if (actionIntentRaw) features._intent_override_action_raw = actionIntentRaw;
      }
      if (reverseExceptionDetail) {
        features._reverse_exception_applied = true;
        features._reverse_exception = reverseExceptionDetail;
      }
      if (Number.isFinite(price)) features.price = price;
      if (strategyId) features.strategy_id = strategyId;
      features._strategy_gate_enabled = WEBHOOK_STRATEGY_GATE_ENABLED;
      features._strategy_id_present = strategyIdPresent;
      if (tracePayloadVersion) features.trace_payload_version = tracePayloadVersion;
      if (traceEmitMode) features.trace_emit_mode = traceEmitMode;
      if (traceChainKey) features.trace_chain_key = traceChainKey;
      if (costShieldEnable !== null) features.cost_shield_enable = costShieldEnable;
      if (Number.isFinite(costShieldEntryMult)) features.cost_shield_entry_mult = costShieldEntryMult;
      if (costShieldBlockAdd !== null) features.cost_shield_block_add = costShieldBlockAdd;
      if (Number.isFinite(costShieldGapMult)) features.cost_shield_gap_mult = costShieldGapMult;
      if (exitPolicySource) features.exit_policy_source = exitPolicySource;
      if (Number.isFinite(exitPolicySlPct)) features.exit_policy_sl_pct = exitPolicySlPct;
      if (Number.isFinite(exitPolicyTp1Pct)) features.exit_policy_tp1_pct = exitPolicyTp1Pct;
      if (Number.isFinite(exitPolicyBePct)) features.exit_policy_be_pct = exitPolicyBePct;
      if (Number.isFinite(exitPolicyTrailPct)) features.exit_policy_trail_pct = exitPolicyTrailPct;
      if (Number.isFinite(exitPolicyRunnerMinProfitPct)) features.exit_policy_runner_min_profit_pct = exitPolicyRunnerMinProfitPct;
      if (qtySanitized !== null) features.qty_sanitized = qtySanitized;
      if (Number.isFinite(confidence)) features.confidence = confidence;
      if (Number.isFinite(accountBalance)) features.account_balance = accountBalance;
      if (currentPosition != null) features.current_position = currentPosition;
      if (riskConfig != null) features.risk_config = riskConfig;
      if (exitCandidate) {
        const posSide = String((pos && (pos.position_side || pos.positionSide || pos.side)) || "").toUpperCase() || null;
        if (posSide) features._position_side = posSide;
        if (exchange === "BINANCEFUT") {
          features._exit_side_forced = true;
        }
      }
      if (!features.signal_id && p.signal_id) {
        features.signal_id = p.signal_id;
      }
      if (actionFinal) {
        features.action = actionFinal;
      }
      if (reasonRaw != null) {
        features._reason_raw = reasonRaw;
      }
      features.reason = reason;
      if (features._qty_pct_raw == null) {
        features._qty_pct_raw = qtyPctRaw == null ? qtyPct : qtyPctRaw;
      }
      if (features._qty_pct_sanitized == null) {
        features._qty_pct_sanitized = qtyPct;
      }
      if (qtyPctWasClamped) {
        features._qty_pct_before_clamp = qtyPctParsed;
        features._qty_pct_clamped = true;
      }

      let qtyPctFinal = qtyPct;
      if (!isDrop) {
        const aiTimeoutFallback = buildAiTimeoutFallback(qtyPct);
        const aiRes = await withTimeout(evaluateSignalWithAi({
          exchange,
          symbol,
          tf,
          event,
          side,
          qtyPct,
          intent,
          reason,
          features,
          price,
          strategyId,
          confidence,
          accountBalance,
          currentPosition,
          riskConfig,
          barCloseTimeUtcMs: barCloseMs,
        }), AI_EVAL_TIMEOUT_MS, aiTimeoutFallback);
        if (aiRes && aiRes.meta) {
          features.ai_signal = aiRes.meta;
          if (aiRes.meta.ai_webhook_timeout_guard) {
            console.warn("[AI_SIGNAL][WEBHOOK_TIMEOUT_GUARD]", {
              exchange,
              symbol,
              tf,
              event,
              side,
              timeout_ms: AI_EVAL_TIMEOUT_MS,
            });
          }
        }
        const aiDecision = aiRes && aiRes.ok ? aiRes.decision : null;
        const aiBlockDisabled = aiDecision === "BLOCK" && !AI_CAN_BLOCK;
        if (aiDecision === "BLOCK" && AI_CAN_BLOCK) {
          await recordSignalDrops({
            exchange,
            symbol,
            tf,
            drops: [{
              event,
              side,
              bar_close_time_utc_ms: barCloseMs,
              qty_pct: qtyPct,
              reason: "AI_BLOCK",
              execution_mode: executionMode,
              features_json: features,
              event_group: group,
              event_subtype: subtype,
              drop_reason_code: "AI_BLOCK",
              signal_id: p.signal_id || null,
              event_intent: intent,
              mapping_ok: mapping.ok === true,
              mapping_version: SIGNAL_MAPPING_VERSION,
            }],
          });
          emitWebhookTrace(traceOn, {
            decision: "DROP",
            reason: "AI_BLOCK",
            exchange,
            symbol,
            tf_raw: tfRaw,
            tf_final: tf,
            event,
            side,
            action: actionFinal,
            intent,
            qty_pct: qtyPct,
            bar_close_time_utc_ms: barCloseMs,
            mapping_ok: mapping.ok === true,
            exchange_side_allowed: exchangeSideAllowed,
            signal_id: p.signal_id || null,
          });
          fireSignalDroppedAlert({
            exchange,
            symbol,
            tf,
            event,
            side,
            qtyPct,
            reason: "AI_BLOCK",
            dropReasonCode: "AI_BLOCK",
            signalId: p.signal_id || null,
            executionMode: executionMode,
            source: "WEBHOOK",
            authoritative: false,
          });
          return finalize({
            body: { ok: true, dropped: true, reason: "AI_BLOCK", signal_id: p.signal_id || null },
            decision: "DROP",
            reason: "AI_BLOCK",
            context: {
              exchange,
              symbol,
              tf,
              event,
              side,
              action: actionFinal || null,
              intent: intent || null,
              qtyPct,
              signalId: p.signal_id || null,
              barCloseMs,
              mappingOk: mapping.ok === true,
              exchangeSideAllowed,
            },
          });
        }
        if (aiRes && aiRes.ok && Number.isFinite(aiRes.qty_pct_final) && !aiBlockDisabled) {
          qtyPctFinal = aiRes.qty_pct_final;
        }
      }
      if (features._qty_pct_final == null) {
        features._qty_pct_final = qtyPctFinal;
      }

      if (isDrop) {
        await recordSignalDrops({
          exchange,
          symbol,
          tf,
          drops: [{
            event,
            side,
            bar_close_time_utc_ms: barCloseMs,
            qty_pct: qtyPctFinal,
            reason,
            execution_mode: executionMode,
            features_json: features,
            event_group: group,
            event_subtype: subtype,
            drop_reason_code: normalizeReasonCode(reasonRaw) || normalizeReasonCode(reason) || null,
            signal_id: p.signal_id || null,
            event_intent: "DROP",
            mapping_ok: mapping.ok === true,
            mapping_version: SIGNAL_MAPPING_VERSION,
          }],
        });
        emitWebhookTrace(traceOn, {
          decision: "DROP",
          reason,
          exchange,
          symbol,
          tf_raw: tfRaw,
          tf_final: tf,
          event,
          side,
          action: actionFinal,
          intent: "DROP",
          qty_pct: qtyPctFinal,
          bar_close_time_utc_ms: barCloseMs,
          mapping_ok: mapping.ok === true,
          exchange_side_allowed: exchangeSideAllowed,
          signal_id: p.signal_id || null,
        });
        fireSignalDroppedAlert({
          exchange,
          symbol,
          tf,
          event,
          side,
          qtyPct: qtyPctFinal,
          reason,
          dropReasonCode: normalizeReasonCode(reasonRaw) || normalizeReasonCode(reason) || null,
          signalId: p.signal_id || null,
          executionMode: executionMode,
          source: "WEBHOOK",
          authoritative: false,
        });
        return finalize({
          body: { ok: true, dropped: true, signal_id: p.signal_id || null },
          decision: "DROP",
          reason,
          context: {
            exchange,
            symbol,
            tf,
            event,
            side,
            action: actionFinal || null,
            intent: "DROP",
            qtyPct: qtyPctFinal,
            signalId: p.signal_id || null,
            barCloseMs,
            mappingOk: mapping.ok === true,
            exchangeSideAllowed,
          },
        });
      }

      const saved = await upsertSignal({
        exchange,
        symbol,
        tf,
        barCloseTimeUtc: barCloseUtcStr,
        barCloseTimeUtcMs: barCloseMs,
        event,
        side,
        qtyPct: qtyPctFinal,
        reason,
        features,
        executionMode,
        source: "PINE_SHADOW",
        authoritative: false,
      });
      try {
        const confirmation = await confirmSelfEvolutionRuntimeSignal({
          signalId: saved && saved.signal_id ? saved.signal_id : (p.signal_id || null),
          createdAt: new Date().toISOString(),
          event,
          strategyId,
        });
        if (confirmation && confirmation.updated) {
          console.log("[SELF_EVOLUTION_RUNTIME_CONFIRMED]", JSON.stringify({
            signal_id: saved && saved.signal_id ? saved.signal_id : (p.signal_id || null),
            strategy_id: strategyId,
            event,
          }));
        }
      } catch (runtimeErr) {
        console.warn("[SELF_EVOLUTION_RUNTIME_CONFIRM_FAIL]", runtimeErr?.message || runtimeErr);
      }
      emitWebhookTrace(traceOn, {
        decision: "SAVED",
        exchange,
        symbol,
        tf_raw: tfRaw,
        tf_final: tf,
        event,
        side,
        action: actionFinal,
        intent,
        qty_pct: qtyPctFinal,
        bar_close_time_utc_ms: barCloseMs,
        mapping_ok: mapping.ok === true,
        exchange_side_allowed: exchangeSideAllowed,
        signal_id: saved && saved.signal_id ? saved.signal_id : (p.signal_id || null),
      });
      persistWebhookSignalExecutionProbe({
        requestId,
        exchange,
        symbol,
        tf,
        signalId: saved && saved.signal_id ? saved.signal_id : (p.signal_id || null),
        phase: "SAVED",
        saved: true,
        summary: {
          status: "SAVED",
          detail: {
            strategy_id: strategyId || null,
            event,
            side,
            reason,
            execution_mode: executionMode || null,
            febt_payload_missing: features.febt_payload_missing === true,
            mapping_ok: mapping.ok === true,
            intent: intent || null,
          },
        },
      });

      if (WEBHOOK_IMMEDIATE_PROCESS) {
        const immediatePayload = {
          exchange,
          symbol,
          tf,
          signalId: saved && saved.signal_id ? saved.signal_id : (p.signal_id || null),
        };
        persistWebhookSignalExecutionProbe({
          requestId,
          exchange,
          symbol,
          tf,
          signalId: immediatePayload.signalId,
          phase: "IMMEDIATE_PROCESS_SKIPPED",
          saved: true,
          summary: {
            status: "SHADOW_ONLY",
            detail: {
              source: "PINE_SHADOW",
              authoritative: false,
              reason: "PINE_SHADOW_DOES_NOT_ENTER_EXECUTION_CHAIN",
            },
          },
        });
      }

      return finalize({
        body: { ok: true, signal_id: saved.signal_id },
        decision: "SAVED",
        reason,
        context: {
          exchange,
          symbol,
          tf,
          event,
          side,
          action: actionFinal || null,
          intent: intent || null,
          qtyPct: qtyPctFinal,
          signalId: saved && saved.signal_id ? saved.signal_id : (p.signal_id || null),
          barCloseMs,
          mappingOk: mapping.ok === true,
          exchangeSideAllowed,
        },
      });
    } catch (err) {
      emitWebhookTrace(traceOn, {
        decision: "ERROR",
        reason: err?.message || String(err),
      });
      try {
        await recordWebhookOutcome({
          requestId,
          httpStatus: 500,
          decision: "ERROR",
          reason: "WEBHOOK_ERROR",
          error: err?.message || String(err),
        });
      } catch (e) {
        console.warn("[WEBHOOK_LEDGER_OUTCOME_FAIL]", e?.message || e);
      }
      return res.status(500).json({ ok: false, stage: "WEBHOOK_ERROR", message: err?.message || String(err) });
    }
  });

  return router;
}

module.exports = createWebhookRoutes;
module.exports.__test = {
  buildRuntimeStrategyGate,
  parseAllowedStrategyIds,
  resolvePayloadStrategyIdentity,
};
