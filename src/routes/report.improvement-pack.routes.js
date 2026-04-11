const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const JSZip = require("jszip");
const { getFirestore } = require("../storage/firestore");
const { getSystemSettingsForProvider, getExchangesSettingsCached } = require("../storage/settings");
const { getMarketsExpected, getEffectiveExchangesSettings, getMultiExchangesSettings, getRiskBudgetForProvider } = require("../utils/exchangeSettings");
const { tfToMs, normalizeTf, defaultExecTfFromEnv } = require("../utils/marketConfig");
const { buildDeterministicReplayResult } = require("../utils/improvementPackDeterminism");
const { mapSnapshotBarsForPack, buildImprovementPackDataQuality } = require("../utils/improvementPackDataQuality");
const { queryBars, upsertBarSnapshot } = require("../storage/barsSnapshots");
const { inferExchangeFromMarket } = require("../utils/marketExchange");
const { isLiveDocForExchange } = require("../utils/liveOnly");
const { toKstStringFromMs, toKstString } = require("../utils/timeKst");
const { buildFundingIndexForFills, sumFunding } = require("../services/fundingFees");
const { summarizePineSignalQuality } = require("../services/pineSignalQuality");
const { summarizeFebtByTier } = require("../utils/febtSummary");
const { fetchCandles } = require("../exchanges");
const { normalizePositionSide } = require("../utils/positionSide");
const {
  canonicalExternalEntryEvent,
  isLegacyTierEntryEvent,
} = require("../utils/liveEntryTaxonomy");
const { listExchangePositionReadViews } = require("../services/positionReadModel");

const router = express.Router();

const BASE_TF = defaultExecTfFromEnv() || "15m";
const DEFAULT_BASE_TF_MS = tfToMs(BASE_TF) || (15 * 60 * 1000);
const PACK_SCHEMA = "donbeolja_improvement_pack_v1";
const DEFAULT_STRATEGY_ID = process.env.DONBEOLJA_STRATEGY_ID || "STRAT_v010";
const DEFAULT_LIMIT_DOCS = 50000;
const DEFAULT_BARS_LIMIT = Number(process.env.IMPROVEMENT_PACK_BARS_LIMIT || 3000);
const IMPROVEMENT_PACK_AUTO_BACKFILL = String(process.env.IMPROVEMENT_PACK_AUTO_BACKFILL || "1") === "1";
const IMPROVEMENT_PACK_MAX_BACKFILL_MARKETS = Number(process.env.IMPROVEMENT_PACK_MAX_BACKFILL_MARKETS || 20);
const IMPROVEMENT_PACK_RECENT_RANGE_MAX_MS = Number(process.env.IMPROVEMENT_PACK_RECENT_RANGE_MAX_MS || (21 * 24 * 60 * 60 * 1000));
const NEG_SAMPLE_PER_WEEK = 200;
const FULL_SIGNAL_TYPES = [
  "LONG",
  "SHORT",
  "EMO_LONG",
  "EMO_SHORT",
  "SS_LONG",
  "SS_SHORT",
  "TD9P_BUY",
  "TD9P_SELL",
  "VOL_ULTRA",
  "VOL_STRONG",
  "VOL_WEAK",
  "ICHI_BELL_LONG",
  "ICHI_BELL_SHORT",
  "EV_PASS_CORE_L",
  "EV_BLOCK_CORE_L",
  "EV_PASS_CORE_S",
  "EV_BLOCK_CORE_S",
  "EV_PASS_REAL_L",
  "EV_BLOCK_REAL_L",
  "EV_PASS_REAL_S",
  "EV_BLOCK_REAL_S",
  "ZZ_WAVE_PASS_L",
  "ZZ_WAVE_BLOCK_L",
  "ZZ_WAVE_PASS_S",
  "ZZ_WAVE_BLOCK_S",
  "CONFLICT_BLOCK_L",
  "CONFLICT_BLOCK_S",
  "SESSION_DEBUFF_APPLIED",
  "BW_ZONE_STATE",
  "EXIT_ALL",
  "EXIT_FORCE_ALL",
  "EXIT_OPPOSITE_SIGNAL",
  "EXIT_SL_2P",
  "EXIT_SL_3P",
  "EXIT_SL_4P",
  "EXIT_BE_0P",
  "EXIT_TP_C_5P",
  "EXIT_TP_P1_5P",
  "EXIT_TP_P1_3P",
  "EXIT_TRAIL_2P",
  "EXIT_LIQUIDATION_RISK",
  "EXIT_CORE_25",
  "EXIT_REAL_25",
  "TP_C_5P",
  "FORCE_EXIT",
  "FORCE_EXIT_OVERNIGHT",
  "FORCE_EXIT_RISK",
  "HEDGE_ON",
  "HEDGE_OFF",
];
const COOLDOWN_SIGNAL_TYPES = [
  "LONG",
  "SHORT",
];
const FULL_SIGNAL_TYPE_SET = new Set([
  ...FULL_SIGNAL_TYPES,
  ...COOLDOWN_SIGNAL_TYPES.map((t) => `COOLDOWN_BLOCK_${t}`),
  "UNKNOWN_EVENT",
]);

function nowIso() {
  return new Date().toISOString();
}

function toMs(v) {
  const t = Date.parse(String(v || ""));
  return Number.isFinite(t) ? t : null;
}

function parseSignalIdBarMs(signalId) {
  if (!signalId) return null;
  const parts = String(signalId).split("|");
  if (parts.length < 4) return null;
  const msAt3 = Number(parts[3]);
  if (Number.isFinite(msAt3)) return msAt3;
  const msAt2 = Number(parts[2]);
  return Number.isFinite(msAt2) ? msAt2 : null;
}

function resolveSignalBarCloseMs({ intent, fill, execMs, tf }) {
  const tfRaw = (intent && intent.tf) || (fill && fill.tf) || tf;
  const tfMs = tfToMs(tfRaw);
  const candidates = [
    intent && (intent._bar_ms || intent.signal_bar_close_time_utc_ms),
    fill && fill.signal_bar_close_time_utc_ms,
    fill && parseSignalIdBarMs(fill.signal_id),
  ];
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (Number.isFinite(execMs)) return execMs - (Number.isFinite(tfMs) ? tfMs : DEFAULT_BASE_TF_MS);
  return null;
}

function toKstStringSafe(v) {
  if (!v) return null;
  const raw = String(v);
  if (raw.includes("KST")) return raw;
  return toKstString(raw, { fallbackToString: true });
}

function yyyyMmDdUtc(ms) {
  const d = new Date(ms);
  return d.toISOString().slice(0, 10);
}

function normalizeExchangeId(raw) {
  const v = String(raw || "").trim().toUpperCase();
  if (!v) return "BINANCEFUT";
  if (v.includes("BINANCE")) return "BINANCEFUT";
  if (v.includes("BINANCEFUT")) return "BINANCEFUT";
  return v;
}

async function resolveMarketsExpected(exchanges) {
  const wanted = (Array.isArray(exchanges) ? exchanges : []).map(normalizeExchangeId);
  const multi = await getMultiExchangesSettings(2000);
  if (multi && Array.isArray(multi.exchanges) && wanted.length) {
    const out = [];
    for (const ex of wanted) {
      const found = multi.exchanges.find((x) => String(x.provider || "").toUpperCase() === ex);
      if (found && Array.isArray(found.markets) && found.markets.length) {
        out.push(...found.markets);
      }
    }
    if (out.length) return Array.from(new Set(out));
  }
  return await getMarketsExpected(2000);
}

function normalizeEvent(event) {
  return String(event || "").trim().toUpperCase().replace(/\s+/g, "_");
}

function normalizeSide(side) {
  return normalizePositionSide(side, null) || "NEUTRAL";
}

function extractZigzagSections(text) {
  if (!text) return null;
  const lines = String(text).split(/\r?\n/);
  const out = [];
  let on = false;
  for (const line of lines) {
    if (line.includes("[ZZ_FUSION_START]")) on = true;
    if (on) out.push(line);
    if (line.includes("[ZZ_FUSION_END]")) on = false;
  }
  return out.length ? out.join("\n") : null;
}

function makeSignalId({ exchange, market, tf, barCloseMs }) {
  return `${exchange}|${market}|${tf}|${barCloseMs}`;
}

function makeEventId({ exchange, market, tf, barCloseMs, signalType, event }) {
  const base = makeSignalId({ exchange, market, tf, barCloseMs });
  const ev = normalizeEvent(event) || "UNKNOWN";
  return `${base}|${signalType}|${ev}`;
}

function isExitEventName(event) {
  const e = normalizeEvent(event);
  if (!e) return false;
  if (e === "EXIT") return true;
  if (e.startsWith("EXIT_") || e.startsWith("TP_") || e.startsWith("SL_")) return true;
  if (e.startsWith("FORCE_EXIT") || e.startsWith("HEDGE_")) return true;
  if (e.includes("TAKE_PROFIT") || e.includes("STOP_LOSS")) return true;
  return false;
}

function mapSignalType(event, side) {
  const e = normalizeEvent(event);
  const sd = normalizeSide(side);
  if (!e) return "UNKNOWN";
  if (FULL_SIGNAL_TYPE_SET.has(e)) return e;

  if (e === "LONG" || e === "SHORT") return e;

  if (e.startsWith("COOLDOWN_BLOCK_")) {
    const blockedRaw = e.replace(/^COOLDOWN_BLOCK_/, "");
    const blockedEntry = canonicalExternalEntryEvent(blockedRaw, sd);
    if (blockedEntry) {
      const mapped = `COOLDOWN_BLOCK_${blockedEntry}`;
      return FULL_SIGNAL_TYPE_SET.has(mapped) ? mapped : "UNKNOWN_EVENT";
    }
  }

  const primaryEntry = canonicalExternalEntryEvent(e, sd);
  if (primaryEntry && FULL_SIGNAL_TYPE_SET.has(primaryEntry)) return primaryEntry;

  if (e.startsWith("EV_PASS") || e.startsWith("EV_BLOCK") || e.startsWith("ZZ_WAVE") || e.startsWith("CONFLICT_BLOCK") || e.startsWith("COOLDOWN_BLOCK") || e.startsWith("SESSION_DEBUFF") || e.startsWith("BW_ZONE_STATE")) {
    const mapped = e;
    return FULL_SIGNAL_TYPE_SET.has(mapped) ? mapped : "UNKNOWN_EVENT";
  }

  if (e.includes("ICHI") && e.includes("BELL")) {
    const mapped = sd === "SHORT" ? "ICHI_BELL_SHORT" : "ICHI_BELL_LONG";
    return FULL_SIGNAL_TYPE_SET.has(mapped) ? mapped : "UNKNOWN_EVENT";
  }

  if (e.includes("TD9P")) {
    const mapped = sd === "SHORT" ? "TD9P_SELL" : "TD9P_BUY";
    return FULL_SIGNAL_TYPE_SET.has(mapped) ? mapped : "UNKNOWN_EVENT";
  }

  if (e.includes("SS")) {
    const mapped = sd === "SHORT" ? "SS_SHORT" : "SS_LONG";
    return FULL_SIGNAL_TYPE_SET.has(mapped) ? mapped : "UNKNOWN_EVENT";
  }

  if (e.includes("VOL_ULTRA")) return "VOL_ULTRA";
  if (e.includes("VOL_STRONG")) return "VOL_STRONG";
  if (e.includes("VOL_WEAK")) return "VOL_WEAK";

  if (e.includes("EMO")) {
    const mapped = sd === "SHORT" ? "EMO_SHORT" : "EMO_LONG";
    return FULL_SIGNAL_TYPE_SET.has(mapped) ? mapped : "UNKNOWN_EVENT";
  }
  if (isLegacyTierEntryEvent(e)) {
    const mapped = sd === "SHORT" ? "SHORT" : "LONG";
    return FULL_SIGNAL_TYPE_SET.has(mapped) ? mapped : "UNKNOWN_EVENT";
  }

  if (e.startsWith("EXIT_") || e.startsWith("TP_") || e.startsWith("FORCE_EXIT") || e.startsWith("HEDGE_")) {
    return e;
  }
  if (isExitEventName(e)) return e;

  if (e.endsWith("_LONG") || e.endsWith("_SHORT")) {
    return FULL_SIGNAL_TYPE_SET.has(e) ? e : "UNKNOWN_EVENT";
  }

  return "UNKNOWN_EVENT";
}

function signalPurpose(signalType) {
  const t = String(signalType || "").toUpperCase();
  if (t === "UNKNOWN_EVENT") return "unknown";
  if (
    t.startsWith("EXIT_") ||
    t.startsWith("TP_") ||
    t.startsWith("SL_") ||
    t.startsWith("FORCE_EXIT") ||
    t.startsWith("HEDGE_") ||
    t.includes("TAKE_PROFIT") ||
    t.includes("STOP_LOSS")
  ) return "exit";
  if (t.startsWith("EV_") || t.includes("BLOCK") || t.includes("PASS") || t.startsWith("ZZ_WAVE")) return "filter";
  if (t.startsWith("EMO") || t.startsWith("VOL_") || t.startsWith("ICHI_BELL") || t.startsWith("SS") || t.startsWith("TD9P")) return "annotation";
  if (t === "LONG" || t === "SHORT") return "entry";
  if (t === "NEG_SAMPLE") return "sample";
  return "entry";
}

function isKpiEligibleSignalType(signalType) {
  const p = signalPurpose(signalType);
  return p === "entry" || p === "annotation";
}

function signalDirection(signalType) {
  const t = String(signalType || "").toUpperCase();
  if (t === "UNKNOWN_EVENT") return "neutral";
  if (t === "LONG") return "long";
  if (t === "SHORT") return "short";
  if (t.endsWith("_LONG") || t.endsWith("_L") || t.endsWith("_BUY")) return "long";
  if (t.endsWith("_SHORT") || t.endsWith("_S") || t.endsWith("_SELL")) return "short";
  if (t === "NEG_SAMPLE") return "neutral";
  return "neutral";
}

function priorityRank(signalType) {
  const t = String(signalType || "").toUpperCase();
  if (t === "LONG" || t === "SHORT") return 4;
  if (t.startsWith("SS")) return 5;
  if (t.startsWith("TD9P")) return 6;
  if (t.startsWith("EMO")) return 7;
  if (t.startsWith("ICHI_BELL")) return 8;
  if (t.startsWith("VOL_")) return 9;
  return 99;
}

function dependencies(signalType) {
  const t = String(signalType || "").toUpperCase();
  if (t.startsWith("EV_")) return ["EV"];
  if (t.startsWith("ZZ_WAVE")) return ["ZIGZAG"];
  if (t.startsWith("CONFLICT_BLOCK")) return ["CONFLICT"];
  if (t.startsWith("COOLDOWN_BLOCK")) return ["COOLDOWN"];
  if (t.startsWith("BW_ZONE")) return ["BAND_WIDTH"];
  if (t.startsWith("ICHI_BELL")) return ["ICHIMOKU"];
  if (t.startsWith("TD9P")) return ["TD9"];
  if (t.startsWith("SS")) return ["SS"];
  if (t.startsWith("VOL_")) return ["VOLUME"];
  if (t.startsWith("EMO")) return ["EMOJI"];
  if (t === "LONG" || t === "SHORT") return ["TREND", "EV", "ZIGZAG"];
  return [];
}

function expectedBehaviorForSignal(signalType) {
  const t = String(signalType || "").toUpperCase();
  if (t === "LONG" || t === "SHORT") return "Primary live entry; source timing is EARLY or CORE and quantity profile is FIXED.";
  if (t.startsWith("EV_") || t.startsWith("ZZ_WAVE") || t.startsWith("CONFLICT_BLOCK") || t.startsWith("COOLDOWN_BLOCK") || t.startsWith("BW_ZONE")) {
    return "Filter event; controls keep/drop gating.";
  }
  if (t.startsWith("ICHI_BELL")) return "Ichimoku bell annotation; not a direct trade trigger.";
  if (t.startsWith("TD9P")) return "TD9 prime annotation; context signal only.";
  if (t.startsWith("SS")) return "SS annotation; context signal only.";
  if (t.startsWith("VOL_")) return "Volume emoji annotation; context signal only.";
  if (t.startsWith("EMO")) return "Emoji annotation; not a direct trade trigger.";
  if (t === "NEG_SAMPLE") return "Negative sample; used for evaluation only.";
  return "Behavior not defined.";
}

function cooldownRuleForSignal(signalType) {
  const t = String(signalType || "").toUpperCase();
  if (t === "LONG" || t === "SHORT") return "gap_early_base";
  if (t.startsWith("COOLDOWN_BLOCK")) return "gap rule of source signal";
  return "n/a";
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes("\"")) {
    const q = s.replace(/\"/g, '""');
    return `"${q}"`;
  }
  if (s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s}"`;
  }
  return s;
}

function toCsv(rows, columns) {
  const header = columns.join(",");
  const lines = [header];
  for (const row of rows) {
    const line = columns.map((c) => csvEscape(row[c])).join(",");
    lines.push(line);
  }
  return lines.join("\n");
}

function gzipBuffer(text) {
  return zlib.gzipSync(Buffer.from(text, "utf8"));
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function readFileSafe(fp) {
  try {
    if (!fp) return { ok: false, error: "EMPTY_PATH" };
    const data = fs.readFileSync(fp, "utf8");
    const stat = fs.statSync(fp);
    return {
      ok: true,
      text: data,
      sha256: sha256Hex(data),
      mtime_utc: stat.mtime ? stat.mtime.toISOString() : null,
      size: stat.size,
      path: fp,
    };
  } catch (e) {
    return { ok: false, error: e.message || "READ_FAILED" };
  }
}

function readJsonSafe(fp) {
  try {
    if (!fp) return { ok: false, error: "EMPTY_PATH" };
    if (!fs.existsSync(fp)) return { ok: false, error: "NOT_FOUND" };
    const raw = fs.readFileSync(fp, "utf8");
    const data = JSON.parse(raw);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message || "READ_FAILED" };
  }
}

function extractRuntimeInputs(payload) {
  if (!payload || typeof payload !== "object") return null;
  const candidates = [
    payload.inputs,
    payload.pine_inputs,
    payload.runtime_inputs,
    payload.input_values,
    payload.values,
  ];
  for (const c of candidates) {
    if (c && typeof c === "object") return c;
  }
  return null;
}

function extractParam(full, name) {
  const re = new RegExp(`${name}\\s*=\\s*([^,\\)\\n]+)`, "i");
  const m = full.match(re);
  return m ? m[1].trim() : null;
}

function parseLiteral(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s === "true" || s === "false") return s === "true";
  if ((s.startsWith("\"") && s.endsWith("\"")) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  const n = Number(s);
  if (Number.isFinite(n)) return s.includes(".") ? n : Math.trunc(n);
  return s;
}

function parseOptions(raw) {
  if (!raw) return null;
  const m = String(raw).match(/\[(.*)\]/);
  if (!m) return null;
  return m[1]
    .split(",")
    .map((x) => parseLiteral(x))
    .filter((x) => x !== null);
}

function inputTypeOf(sig) {
  const s = String(sig || "").toLowerCase();
  if (s.includes("input.bool")) return "bool";
  if (s.includes("input.int")) return "int";
  if (s.includes("input.float")) return "float";
  if (s.includes("input.string")) return "string";
  if (s.includes("input.timeframe")) return "timeframe";
  if (s.includes("input.symbol")) return "symbol";
  if (s.includes("input.color")) return "color";
  return "float";
}

function isUiOnly(varName, title) {
  const n = String(varName || "").toLowerCase();
  const t = String(title || "").toLowerCase();
  const hit = (s) => /show_|ui_|panel_|color|plot|label|text|font|opacity|display|style/.test(s);
  return hit(n) || hit(t);
}

function affectsSignals(varName, title, group) {
  const s = [varName, title, group].join(" ").toLowerCase();
  if (isUiOnly(varName, title)) return false;
  return /(ev|zz|zig|thr|threshold|prob|rr|gap|cooldown|slope|mom|trend|atr|rsi|stoch|band|breakwater|session|conflict|weight|score|filter|vol|strength)/.test(s);
}

function signalTypesForKey(varName, catalog) {
  const n = String(varName || "").toLowerCase();
  const all = (catalog || []).map((x) => x.signal_type);
  const pick = (kw) => all.filter((t) => String(t).toLowerCase().includes(kw));
  if (n.includes("pre_real") || n.includes("prereal")) return pick("pre_real");
  if (n.includes("real")) return pick("real");
  if (n.includes("core")) return pick("core");
  if (n.includes("early")) return pick("early");
  if (n.includes("emo")) return pick("emo");
  if (n.includes("ichi") || n.includes("bell")) return pick("ichi_bell");
  if (n.includes("td9")) return pick("td9");
  if (n.includes("ss")) return pick("ss");
  if (n.includes("vol")) return pick("vol_");
  if (n.includes("zz") || n.includes("zig")) return pick("zz_wave");
  if (n.includes("ev")) return pick("ev_");
  return [];
}

function parsePineInputs(code, filePath) {
  const lines = String(code || "").split(/\r?\n/);
  const registry = [];
  const errors = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(input(?:\.[A-Za-z0-9_]+)?)\s*\(/);
    if (!m) continue;
    const varName = m[1];
    const sig = m[2];
    let chunk = line;
    let depth = (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;
    let j = i + 1;
    while (depth > 0 && j < lines.length) {
      chunk += " " + lines[j].trim();
      depth += (lines[j].match(/\(/g) || []).length - (lines[j].match(/\)/g) || []).length;
      j += 1;
    }
    const inputType = inputTypeOf(sig);
    const defRaw = extractParam(chunk, "defval") || chunk.split("(")[1]?.split(",")[0];
    const titleRaw = extractParam(chunk, "title") || chunk.split(",")[1];
    const groupRaw = extractParam(chunk, "group");
    const minRaw = extractParam(chunk, "minval");
    const maxRaw = extractParam(chunk, "maxval");
    const stepRaw = extractParam(chunk, "step");
    const optionsRaw = extractParam(chunk, "options");
    const defVal = parseLiteral(defRaw);
    const title = parseLiteral(titleRaw);
    const uiOnly = isUiOnly(varName, title);
    const affects = affectsSignals(varName, title, groupRaw);
    const constraints = {};
    const minVal = parseLiteral(minRaw);
    const maxVal = parseLiteral(maxRaw);
    const stepVal = parseLiteral(stepRaw);
    const options = parseOptions(optionsRaw);
    if (minVal != null) constraints.min = minVal;
    if (maxVal != null) constraints.max = maxVal;
    if (stepVal != null) constraints.step = stepVal;
    if (options && options.length) constraints.options = options;
    registry.push({
      var_name: varName,
      input_type: inputType,
      title_ko: title || "",
      group_name: groupRaw ? parseLiteral(groupRaw) : null,
      default_value: defVal,
      constraints: Object.keys(constraints).length ? constraints : {},
      ui_only: uiOnly,
      affects_signals: affects,
      tuning_lock_reason: uiOnly ? "UI_ONLY" : null,
      code_anchor: {
        file: filePath || "/code/donbeolja.pine.txt",
        line_start: i + 1,
        line_end: j,
        snippet: chunk.slice(0, 120),
      },
    });
  }
  if (!registry.length) {
    errors.push("NO_INPUTS_FOUND");
  }
  return { registry, errors };
}

function runtimeTypeForValue(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  if (t === "boolean") return "bool";
  if (t === "number") return Number.isInteger(value) ? "int" : "float";
  if (t === "string") return "string";
  return t;
}

function calcDeltaMax(reg) {
  if (!reg || (reg.input_type !== "int" && reg.input_type !== "float")) return null;
  const step = reg.constraints?.step;
  if (Number.isFinite(step) && step > 0) return step;
  const min = reg.constraints?.min;
  const max = reg.constraints?.max;
  if (Number.isFinite(min) && Number.isFinite(max)) return (max - min) * 0.05;
  const def = reg.default_value;
  if (typeof def === "number") {
    const base = Math.abs(def) || 1;
    return base * 0.1;
  }
  return 0.1;
}

function proposeNumericChange(value, reg, direction, multiplier) {
  if (!Number.isFinite(value)) return { newValue: value, delta: null };
  const deltaMax = calcDeltaMax(reg);
  if (!Number.isFinite(deltaMax) || deltaMax === 0) return { newValue: value, delta: null };
  const mult = Number.isFinite(multiplier) ? multiplier : 1;
  let delta = deltaMax * mult;
  if (direction === "down") delta = -Math.abs(delta);
  if (direction === "up") delta = Math.abs(delta);
  let next = value + delta;
  const min = reg.constraints?.min;
  const max = reg.constraints?.max;
  if (Number.isFinite(min) && next < min) next = min;
  if (Number.isFinite(max) && next > max) next = max;
  const step = reg.constraints?.step;
  if (Number.isFinite(step) && step > 0) {
    const base = Number.isFinite(min) ? Number(min) : 0;
    const steps = Math.round((next - base) / step);
    next = base + steps * step;
    next = Number(next.toFixed(10));
  }
  if (reg.input_type === "int") next = Math.round(next);
  return { newValue: next, delta: next - value };
}

function isStepAligned(value, step, min) {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return true;
  const base = Number.isFinite(min) ? min : 0;
  const diff = (value - base) / step;
  return Math.abs(diff - Math.round(diff)) < 1e-6;
}

function validatePatchProposal(patch, tuningPolicy, allowedKeyMap) {
  const errors = [];
  const maxKeys = tuningPolicy?.weekly_change_limit?.max_keys ?? 2;
  const changes = Array.isArray(patch?.changed_keys) ? patch.changed_keys : [];
  if (changes.length > maxKeys) {
    errors.push(`TOO_MANY_KEYS:${changes.length}>${maxKeys}`);
  }

  for (const ch of changes) {
    const key = ch && ch.key ? String(ch.key) : "";
    if (!key) {
      errors.push("MISSING_KEY");
      continue;
    }
    const rule = allowedKeyMap.get(key);
    if (!rule) {
      errors.push(`KEY_NOT_ALLOWED:${key}`);
      continue;
    }
    const delta = Number(ch.delta);
    if (Number.isFinite(rule.delta_max_per_week) && Number.isFinite(delta)) {
      if (Math.abs(delta) > Number(rule.delta_max_per_week) + 1e-9) {
        errors.push(`DELTA_EXCEEDS_MAX:${key}`);
      }
    }
    if (Array.isArray(rule.safe_range) && Number.isFinite(ch.new_value)) {
      const [min, max] = rule.safe_range;
      if (Number.isFinite(min) && ch.new_value < min) errors.push(`BELOW_MIN:${key}`);
      if (Number.isFinite(max) && ch.new_value > max) errors.push(`ABOVE_MAX:${key}`);
    }
    if (Number.isFinite(rule.step) && Number.isFinite(ch.new_value)) {
      const [min] = Array.isArray(rule.safe_range) ? rule.safe_range : [null];
      if (!isStepAligned(Number(ch.new_value), Number(rule.step), Number(min))) {
        errors.push(`STEP_MISMATCH:${key}`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

function seededRng(seed) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pickFeature(obj, keys) {
  if (!obj || typeof obj !== "object") return null;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return null;
}

function normalizeTfValue(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const normalized = normalizeTf(raw);
  return normalized || raw;
}

function sanitizeConfig(obj) {
  const out = {};
  const deny = ["api_key", "api_secret", "token", "cookie", "email", "server_url", "session", "secret"];
  for (const [k, v] of Object.entries(obj || {})) {
    const key = String(k || "").toLowerCase();
    if (deny.some((d) => key.includes(d))) continue;
    out[k] = v;
  }
  return out;
}

function wilsonLowerUpper(wins, n, z) {
  if (n === 0) return { lo: null, hi: null };
  const p = wins / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom;
  return { lo: center - half, hi: center + half };
}

async function fetchSignalsInRange(db, { fromMs, toMsVal, exchanges, tf, limitDocs }) {
  const snap = await db.collection("signals").orderBy("created_at", "desc").limit(limitDocs).get();
  const out = [];
  const wantTf = normalizeTfValue(tf);
  const liveOnly = String(process.env.IMPROVEMENT_PACK_LIVE_ONLY || "").toLowerCase() === "true";
  snap.forEach((d) => {
    const x = d.data() || {};
    const ex = String(x.exchange || "").toUpperCase();
    if (exchanges.length && !exchanges.includes(ex)) return;
    if (liveOnly && !isLiveDocForExchange(ex, x)) return;
    const docTf = normalizeTfValue(x.tf);
    if (wantTf && docTf && docTf !== wantTf) return;
    const barMs = Number(x.bar_close_time_utc_ms || 0) || toMs(x.bar_close_time_utc || x.created_at);
    if (!Number.isFinite(barMs)) return;
    if (barMs < fromMs || barMs >= toMsVal) return;
    out.push({ id: d.id, ...x, _bar_ms: barMs });
  });
  return out;
}

async function fetchSignalDropsInRange(db, { fromMs, toMsVal, exchanges, tf, limitDocs }) {
  const snap = await db.collection("signals_dropped").orderBy("created_at", "desc").limit(limitDocs).get();
  const out = [];
  const wantTf = normalizeTfValue(tf);
  const liveOnly = String(process.env.IMPROVEMENT_PACK_LIVE_ONLY || "").toLowerCase() === "true";
  snap.forEach((d) => {
    const x = d.data() || {};
    const ex = String(x.exchange || "").toUpperCase();
    if (exchanges.length && !exchanges.includes(ex)) return;
    if (liveOnly && !isLiveDocForExchange(ex, x)) return;
    const docTf = normalizeTfValue(x.tf);
    if (wantTf && docTf && docTf !== wantTf) return;
    const barMs = Number(x.bar_close_time_utc_ms || 0) || toMs(x.bar_close_time_utc || x.created_at);
    if (!Number.isFinite(barMs)) return;
    if (barMs < fromMs || barMs >= toMsVal) return;
    out.push({ id: d.id, ...x, _bar_ms: barMs });
  });
  return out;
}

async function fetchIntentsInRange(db, { fromMs, toMsVal, exchanges, tf, limitDocs }) {
  const snap = await db.collection("order_intents_paper").orderBy("created_at", "desc").limit(limitDocs).get();
  const out = [];
  const wantTf = normalizeTfValue(tf);
  snap.forEach((d) => {
    const x = d.data() || {};
    const ex = String(x.exchange || "").toUpperCase();
    if (exchanges.length && !exchanges.includes(ex)) return;
    const docTf = normalizeTfValue(x.tf);
    if (wantTf && docTf && docTf !== wantTf) return;
    const barMs = Number(x.signal_bar_close_time_utc_ms || 0) || toMs(x.signal_bar_close_time_utc || x.created_at);
    if (!Number.isFinite(barMs)) return;
    if (barMs < fromMs || barMs >= toMsVal) return;
    out.push({ id: d.id, ...x, _bar_ms: barMs });
  });
  return out;
}

async function fetchFillsInRange(db, { fromMs, toMsVal, exchanges, tf, limitDocs }) {
  const snap = await db.collection("fills_paper").orderBy("created_at", "desc").limit(limitDocs).get();
  const out = [];
  const wantTf = normalizeTfValue(tf);
  const liveOnly = String(process.env.IMPROVEMENT_PACK_LIVE_ONLY || "").toLowerCase() === "true";
  snap.forEach((d) => {
    const x = d.data() || {};
    const ex = String(x.exchange || "").toUpperCase();
    if (exchanges.length && !exchanges.includes(ex)) return;
    if (liveOnly && !isLiveDocForExchange(ex, x)) return;
    const docTf = normalizeTfValue(x.tf);
    if (wantTf && docTf && docTf !== wantTf) return;
    const execMs = Number(x.exec_bar_close_time_utc_ms || 0) || toMs(x.created_at);
    if (!Number.isFinite(execMs)) return;
    if (execMs < fromMs || execMs >= toMsVal) return;
    out.push({ id: d.id, ...x, _exec_ms: execMs });
  });
  return out;
}

function buildSignalCatalog(signalTypes, activeSet, marketsBySignalType) {
  const shortMap = {
    LONG: "L",
    SHORT: "S",
    EMO_LONG: "EMO_L",
    EMO_SHORT: "EMO_S",
    ICHI_BELL_LONG: "IB_L",
    ICHI_BELL_SHORT: "IB_S",
    SS_LONG: "SS_L",
    SS_SHORT: "SS_S",
    TD9P_BUY: "TD9P_B",
    TD9P_SELL: "TD9P_S",
    VOL_ULTRA: "VOL_U",
    VOL_STRONG: "VOL_S",
    VOL_WEAK: "VOL_W",
  };
  const catalog = [];
  for (const t of signalTypes) {
    const markets = marketsBySignalType && marketsBySignalType[t]
      ? Array.from(marketsBySignalType[t]).sort()
      : [];
    const active = activeSet ? activeSet.has(t) : true;
    catalog.push({
      signal_type: t,
      short_code: shortMap[t] || t.replace(/_/g, ""),
      active,
      active_markets: markets,
      active_markets_n: markets.length,
      inactive_reason: active ? null : "NO_EVENTS_IN_PACK",
      role: signalPurpose(t).toUpperCase(),
      purpose: signalPurpose(t),
      direction: signalDirection(t),
      priority_rank: priorityRank(t),
      code_anchor: `donbeolja:alert:${t}`,
      expected_behavior: expectedBehaviorForSignal(t),
      cooldown_rule: cooldownRuleForSignal(t),
      dependencies: dependencies(t),
    });
  }
  return catalog;
}

function buildEventCatalog(events) {
  return events.map((e) => ({
    event: e,
    normalized_event: normalizeEvent(e),
  }));
}

function buildFieldDictionary() {
  return [
    "# Field Dictionary",
    "- All time fields include *_utc_ms (int64) and *_kst (string)",
    "- price fields are quote currency",
    "- bps fields are basis points (1/100 of 1%)",
  ].join("\n");
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function computeRegimeState({ bars, idx }) {
  if (!Array.isArray(bars)) return null;
  if (!Number.isFinite(idx) || idx < 0 || idx >= bars.length) return null;
  const lookback = Math.min(24, idx + 1);
  if (lookback < 6) return null;

  const start = idx - lookback + 1;
  const first = bars[start];
  const last = bars[idx];
  const firstClose = safeNum(first && first.close);
  const lastClose = safeNum(last && last.close);
  if (!Number.isFinite(firstClose) || !Number.isFinite(lastClose) || firstClose <= 0) return null;

  const ret = (lastClose - firstClose) / firstClose;

  let rangeSum = 0;
  let rangeN = 0;
  for (let i = start; i <= idx; i += 1) {
    const b = bars[i];
    const hi = safeNum(b && b.high);
    const lo = safeNum(b && b.low);
    const cl = safeNum(b && b.close);
    if (!Number.isFinite(hi) || !Number.isFinite(lo) || !Number.isFinite(cl) || cl <= 0) continue;
    rangeSum += (hi - lo) / cl;
    rangeN += 1;
  }
  if (!rangeN) return null;
  const avgRange = rangeSum / rangeN;

  const trendThr = Number(process.env.REGIME_TREND_THRESHOLD || 0.01);
  const volThr = Number(process.env.REGIME_VOL_THRESHOLD || 0.015);

  let trend = "RANGE";
  if (ret >= trendThr) trend = "UP";
  else if (ret <= -trendThr) trend = "DOWN";

  const vol = avgRange >= volThr ? "HIGH_VOL" : "LOW_VOL";
  return `${trend}_${vol}`;
}

function deriveTrendFromRegime(regime) {
  const r = String(regime || "").toUpperCase();
  if (!r) return null;
  if (r.startsWith("UP_")) return "UP";
  if (r.startsWith("DOWN_")) return "DOWN";
  if (r.startsWith("RANGE_")) return "RANGE";
  return null;
}

function dataQualityFlags(bar, prevCloseMs, intervalMs = DEFAULT_BASE_TF_MS) {
  const flags = [];
  if (!bar) return "";
  if (Number.isFinite(prevCloseMs)) {
    const gap = bar.close_ms - prevCloseMs;
    if (gap > intervalMs) flags.push("missing");
    if (gap === 0) flags.push("duplicate");
  }
  if (Number.isFinite(bar.created_at_ms)) {
    const delay = bar.created_at_ms - bar.close_ms;
    if (delay > 15 * 60 * 1000) flags.push("delayed");
  }
  if (bar.high < bar.low) flags.push("outlier");
  if (bar.volume < 0) flags.push("outlier");
  return flags.join("|");
}

function computeMfeMae({ entry, bars, side }) {
  if (!Number.isFinite(entry) || !Array.isArray(bars) || !bars.length) return { mfe: null, mae: null };
  let mfe = null;
  let mae = null;
  const isShort = side === "SHORT";
  for (const b of bars) {
    const high = Number(b.high);
    const low = Number(b.low);
    if (!Number.isFinite(high) || !Number.isFinite(low)) continue;
    if (!isShort) {
      const gain = (high - entry) / entry;
      const loss = (low - entry) / entry;
      if (mfe === null || gain > mfe) mfe = gain;
      if (mae === null || loss < mae) mae = loss;
    } else {
      const gain = (entry - low) / entry;
      const loss = (entry - high) / entry;
      if (mfe === null || gain > mfe) mfe = gain;
      if (mae === null || loss < mae) mae = loss;
    }
  }
  return { mfe, mae };
}

function computeHitTpSl({ entry, bars, side, rPct }) {
  if (!Number.isFinite(entry) || !Array.isArray(bars) || !bars.length) return { hit: null, tpBars: null, slBars: null };
  const isShort = side === "SHORT";
  const tpLevel = isShort ? (entry * (1 - rPct)) : (entry * (1 + rPct));
  const slLevel = isShort ? (entry * (1 + rPct)) : (entry * (1 - rPct));
  let tpBars = null;
  let slBars = null;
  for (let i = 0; i < bars.length; i += 1) {
    const b = bars[i];
    const high = Number(b.high);
    const low = Number(b.low);
    if (!Number.isFinite(high) || !Number.isFinite(low)) continue;
    const hitTp = isShort ? (low <= tpLevel) : (high >= tpLevel);
    const hitSl = isShort ? (high >= slLevel) : (low <= slLevel);
    if (tpBars === null && hitTp) tpBars = i + 1;
    if (slBars === null && hitSl) slBars = i + 1;
    if (tpBars !== null && slBars !== null) break;
  }
  if (tpBars === null && slBars === null) return { hit: null, tpBars: null, slBars: null };
  if (tpBars !== null && (slBars === null || tpBars <= slBars)) return { hit: true, tpBars, slBars };
  return { hit: false, tpBars, slBars };
}

function sliceWindowBars(bars, barCloseMs, windowN) {
  if (!Array.isArray(bars) || !bars.length) return [];
  const idx = bars.findIndex((b) => b.close_ms === barCloseMs);
  if (idx < 0) return [];
  const start = Math.max(0, idx - windowN);
  const end = Math.min(bars.length - 1, idx + windowN);
  return bars.slice(start, end + 1);
}

function buildPrompt() {
  return [
    "너는 ‘돈벌자 Ω’ 신호 개선 퀀트 리서처이자 PineScript 엔지니어다.",
    "입력은 이 ZIP 하나뿐이다. 외부 데이터/추측 금지. ZIP 안의 meta/config/data/analysis/qa/cases만 사용하라.",
    "",
    "목표:",
    "- 각 신호(LONG/SHORT/EMO/🔔 Ichi Bell/SS/TD9P/Vol Emoji/ZigZag/EV)의 precision과 win_rate, EV를",
    "  “과최적화 없이” 개선할 수 있는 패치 후보를 제안한다.",
    "- 패치는 주 1회만, 변경 변수는 1~2개만 허용한다(큰 리팩토링 금지).",
    "- 롤백 기준(악화 조건)과 검증 근거를 반드시 포함한다.",
    "",
    "절차(반드시 이 순서로):",
    "1) 팩 무결성 점검",
    "- qa/data_quality_report.json, qa/deterministic_replay_report.json을 먼저 읽고",
    "  Gate FAIL이면 “개선 제안 보류” 또는 “데이터/재현성 문제 먼저 해결”을 1순위로 제시.",
    "- signal_events ↔ signal_features 조인율, trade_ledger 링크율을 확인하고 이상 시 경고.",
    "",
    "2) 베이스라인 요약",
    "- analysis/kpi_overall.json에서 baseline KPI를 정리.",
    "- kpi_by_signal, kpi_by_market, kpi_by_regime로 “어느 신호가 어디서 망가지는지”를 1페이지 요약.",
    "",
    "3) 문제 유형 분류(신호별)",
    "- FP 과다형(precision 낮음): false_positive 케이스/분포로 원인 후보 추출",
    "- FN 과다형(놓침): false_negative/NEG_SAMPLE 기반으로 원인 후보 추출",
    "- Tail risk형(worst/p10 악화): 시장/레짐/세션 쏠림과 필터 영향 분석",
    "",
    "4) 패치 후보 생성(최대 3개, 각 후보는 변경 1~2변수)",
    "각 패치 후보는 다음 템플릿으로 작성:",
    "- patch_id: YYYYMMDD_signal_focus_vX",
    "- 변경 변수(1~2개): 변수명/현재값/제안값/변경폭(%)",
    "- 가설: 왜 precision/win_rate/EV가 개선될지(데이터 근거: 분포/케이스/레짐 분해)",
    "- 예상 부작용: 거래수 감소, FN 증가, 특정 시장 쏠림, 꼬리위험 등",
    "- 검증 계획:",
    "  (a) walkforward_summary 기반으로 OOS 구간 성과 확인",
    "  (b) regime별 성과 악화 여부 확인",
    "  (c) worst/p10 악화 여부 확인",
    "  (d) 표본수 n<30이면 “보수적 결론” 표기 + 다음 데이터 요구사항 제시",
    "- 롤백 기준(자동/수동): 아래 중 최소 2개 포함",
    "  * OOS win_rate가 baseline 대비 -X%p 이상 하락",
    "  * OOS EV가 baseline 대비 감소",
    "  * worst 또는 p10가 baseline 대비 악화",
    "  * fill_rate가 과도하게 감소(예: -30% 이상)",
    "  * 특정 market/regime 편향이 더 심해짐(예: 한 구간에 70% 이상)",
    "",
    "5) “추천 1개”만 선정",
    "- 위 3개 후보 중 가장 안전(안정성/일관성)한 1개를 ‘이번 주 패치’로 추천하고,",
    "  나머지는 보류/추가데이터 요구로 분류.",
    "",
    "6) 코드 반영 지시(라인 앵커 기준)",
    "- code/donbeolja.pine.txt 또는 코드 해시/앵커를 근거로,",
    "  변경해야 할 input/상수/조건의 위치를 명확히 지시.",
    "- 단, 로직 구조 변경(대규모 리팩토링)은 금지. 파라미터/임계/가중치 조정 위주.",
    "",
    "출력 형식:",
    "- (I) 베이스라인 요약",
    "- (II) 신호별 문제 TOP 5",
    "- (III) 패치 후보 3개(각각 변경 1~2변수)",
    "- (IV) 이번 주 추천 패치 1개 + 롤백 기준 + 검증 체크리스트",
    "- (V) 추가 데이터가 필요하면 “딱 5개 항목”으로만 요청(과도한 요구 금지)",
  ].join("\n");
}

router.get("/api/report/improvement-pack", async (req, res) => {
  try {
    const db = getFirestore();
    const level = String(req.query.level || "STANDARD").toUpperCase();
    const packVer = String(req.query.pack_ver || "v1");
    const exCfg = await getEffectiveExchangesSettings(2000);
    const baseTf = normalizeTfValue(req.query.tf || (Array.isArray(exCfg.tf_allowlist) ? exCfg.tf_allowlist[0] : "") || BASE_TF) || BASE_TF;
    const baseTfMs = tfToMs(baseTf) || DEFAULT_BASE_TF_MS;
    const exchangeParam = String(req.query.exchange || exCfg.provider || "BINANCEFUT").toUpperCase();
    const exchanges = exchangeParam.split("+").map((x) => normalizeExchangeId(x)).filter(Boolean);
    const primaryExchangeName = String(exchanges[0] || "BINANCEFUT").toUpperCase();
    const isPrimaryFutures = primaryExchangeName.includes("BINANCE") || primaryExchangeName.includes("FUT");

    const nowMs = Date.now();
    let fromMs = toMs(req.query.from);
    let toMsVal = toMs(req.query.to);
    if (!Number.isFinite(toMsVal)) toMsVal = nowMs;
    if (!Number.isFinite(fromMs)) fromMs = toMsVal - 12 * 7 * 24 * 60 * 60 * 1000;

    const requestedRange = {
      from_utc: Number.isFinite(fromMs) ? new Date(fromMs).toISOString() : null,
      to_utc: Number.isFinite(toMsVal) ? new Date(toMsVal).toISOString() : null,
    };

    const marketsExpected = await resolveMarketsExpected(exchanges);

    const limitDocs = Number(process.env.IMPROVEMENT_PACK_LIMIT_DOCS || DEFAULT_LIMIT_DOCS);
    const tfMs = baseTfMs;
    const rangeMs = (Number.isFinite(toMsVal) && Number.isFinite(fromMs)) ? (toMsVal - fromMs) : null;
    const expectedBars = (Number.isFinite(rangeMs) && Number.isFinite(tfMs) && tfMs > 0)
      ? Math.ceil(rangeMs / tfMs) + 2
      : DEFAULT_BARS_LIMIT;
    const barsLimit = Math.max(1, Math.min(DEFAULT_BARS_LIMIT, expectedBars));

    const [signalsRaw, dropsRaw, intentsRaw, fillsRaw] = await Promise.all([
      fetchSignalsInRange(db, { fromMs, toMsVal, exchanges, tf: baseTf, limitDocs }),
      fetchSignalDropsInRange(db, { fromMs, toMsVal, exchanges, tf: baseTf, limitDocs }),
      fetchIntentsInRange(db, { fromMs, toMsVal, exchanges, tf: baseTf, limitDocs }),
      fetchFillsInRange(db, { fromMs, toMsVal, exchanges, tf: baseTf, limitDocs }),
    ]);

    const barsByMarket = {};
    for (const mk of marketsExpected) {
      const exForMarket = inferExchangeFromMarket(mk) || exchanges[0] || "BINANCEFUT";
      const bars = await queryBars({ exchange: exForMarket, symbol: mk, tf: baseTf, limit: barsLimit });
      barsByMarket[mk] = mapSnapshotBarsForPack(bars, mk, baseTfMs, fromMs, toMsVal);
    }

    let dataQuality = buildImprovementPackDataQuality(barsByMarket, baseTfMs, toKstStringFromMs);
    dataQuality.integrity = null;

    const autoRepair = {
      enabled: IMPROVEMENT_PACK_AUTO_BACKFILL,
      attempted: false,
      attempted_markets: [],
      repaired_markets: [],
      errors: [],
      before_missing: dataQuality.summary.missing,
      after_missing: dataQuality.summary.missing,
      recovered_missing: 0,
    };
    const repairCandidates = Object.entries(dataQuality.markets)
      .filter(([, q]) => Number(q && q.missing || 0) > 0)
      .slice(0, Math.max(0, IMPROVEMENT_PACK_MAX_BACKFILL_MARKETS))
      .map(([mk]) => mk);
    const canAutoRepairRange = IMPROVEMENT_PACK_AUTO_BACKFILL
      && Number.isFinite(nowMs - toMsVal)
      && (nowMs - toMsVal) <= IMPROVEMENT_PACK_RECENT_RANGE_MAX_MS;
    if (canAutoRepairRange && repairCandidates.length) {
      autoRepair.attempted = true;
      const expectedRepairBars = Math.max(10, Math.min(DEFAULT_BARS_LIMIT, expectedBars + 8));
      for (const mk of repairCandidates) {
        autoRepair.attempted_markets.push(mk);
        const exForMarket = normalizeExchangeId(inferExchangeFromMarket(mk) || exchanges[0] || "BINANCEFUT");
        try {
          const fetched = await fetchCandles(exForMarket, mk, baseTf, expectedRepairBars);
          let written = 0;
          for (const bar of Array.isArray(fetched) ? fetched : []) {
            const closeTimeUtc = bar.closeTimeUtc || bar.t || null;
            const closeTimeUtcMs = Number(bar.closeTimeUtcMs) || (closeTimeUtc ? Date.parse(String(closeTimeUtc)) : null);
            if (!Number.isFinite(closeTimeUtcMs)) continue;
            await upsertBarSnapshot({
              runId: "IMPROVEMENT_PACK_BACKFILL",
              exchange: exForMarket,
              symbol: mk,
              tf: baseTf,
              barCloseTimeUtc: closeTimeUtc,
              barCloseTimeUtcMs: closeTimeUtcMs,
              bar,
            });
            written += 1;
          }
          const refreshed = await queryBars({ exchange: exForMarket, symbol: mk, tf: baseTf, limit: barsLimit });
          barsByMarket[mk] = mapSnapshotBarsForPack(refreshed, mk, baseTfMs, fromMs, toMsVal);
          if (written > 0) autoRepair.repaired_markets.push({ market: mk, exchange: exForMarket, written });
        } catch (e) {
          autoRepair.errors.push({ market: mk, exchange: exForMarket, error: e?.message || String(e) });
        }
      }
      const repairedQuality = buildImprovementPackDataQuality(barsByMarket, baseTfMs, toKstStringFromMs);
      dataQuality = repairedQuality;
      autoRepair.after_missing = repairedQuality.summary.missing;
      autoRepair.recovered_missing = Math.max(0, autoRepair.before_missing - autoRepair.after_missing);
    }

    const intentMap = {};
    const intentById = {};
    for (const it of intentsRaw) {
      const key = `${it.exchange}|${it.symbol_or_pair_id}|${it.tf}|${it.signal_bar_close_time_utc_ms}|${it.event}`;
      intentMap[key] = it;
      if (it.intent_id) intentById[it.intent_id] = it;
    }

    const fillByIntent = {};
    for (const f of fillsRaw) {
      const intentId = f.intent_id || null;
      if (!intentId) continue;
      if (!fillByIntent[intentId]) fillByIntent[intentId] = f;
    }

    const signalEvents = [];
    const signalFeatures = [];
    const forwardLabels = [];
    const signalTypes = new Set();
    const eventsSet = new Set();
    const marketsBySignalType = {};
    const eventIdByBase = new Map();

    const rngSeed = Number(process.env.IMPROVEMENT_PACK_SEED || 1337);
    const rng = seededRng(rngSeed);

    // Build negative samples by market/week
    const negSamples = [];
    for (const mk of marketsExpected) {
      const bars = barsByMarket[mk] || [];
      const exForMarket = inferExchangeFromMarket(mk) || exchanges[0] || "BINANCEFUT";
      const byWeek = {};
      for (const b of bars) {
        const wk = yyyyMmDdUtc(b.close_ms);
        if (!byWeek[wk]) byWeek[wk] = [];
        byWeek[wk].push(b);
      }
      for (const wk of Object.keys(byWeek)) {
        const arr = byWeek[wk];
        const n = Math.min(NEG_SAMPLE_PER_WEEK, arr.length);
        // shuffle
        const copy = arr.slice();
        for (let i = copy.length - 1; i > 0; i -= 1) {
          const j = Math.floor(rng() * (i + 1));
          const tmp = copy[i];
          copy[i] = copy[j];
          copy[j] = tmp;
        }
        for (let i = 0; i < n; i += 1) {
          const b = copy[i];
          negSamples.push({
            exchange: exForMarket,
            market: mk,
            tf: baseTf,
            bar_close_ms: b.close_ms,
            bar_close_utc: b.close_utc,
            close: b.close,
          });
        }
      }
    }

    const allSignals = signalsRaw.map((s) => ({
      source: "signal",
      exchange: s.exchange,
      market: s.symbol_or_pair_id || s.symbol,
      tf: s.tf,
      bar_close_ms: s._bar_ms,
      bar_close_utc: s.bar_close_time_utc || null,
      event: s.event || null,
      side: s.side || null,
      reason: s.reason || null,
      features: s.features_json || {},
      price: Number(s.price || pickFeature(s.features_json, ["price", "close"])) || null,
      event_intent: s.event_intent || null,
    }));

    const dropSignals = dropsRaw.map((d) => ({
      source: "drop",
      exchange: d.exchange,
      market: d.symbol_or_pair_id || d.symbol,
      tf: d.tf,
      bar_close_ms: d._bar_ms,
      bar_close_utc: d.bar_close_time_utc || null,
      event: d.event || null,
      side: d.side || null,
      reason: d.reason || "DROP_FILTER",
      features: d.features_json || {},
      price: Number(d.price || pickFeature(d.features_json, ["price", "close"])) || null,
      drop_reason_code: d.drop_reason_code || "DROP_FILTER",
      event_intent: d.event_intent || null,
    }));

    const mergedSignals = allSignals.concat(dropSignals);
    const eventIdCounts = new Map();
    function uniqueEventId(base) {
      const n = eventIdCounts.get(base) || 0;
      if (n === 0) {
        eventIdCounts.set(base, 1);
        return base;
      }
      const next = n + 1;
      eventIdCounts.set(base, next);
      return `${base}__DUP${String(next).padStart(2, "0")}`;
    }

    for (const s of mergedSignals) {
      const market = s.market || "UNKNOWN";
      const barCloseMs = Number(s.bar_close_ms);
      if (!Number.isFinite(barCloseMs)) continue;
      if (barCloseMs % baseTfMs !== 0) continue;
      const barCloseKst = toKstStringFromMs(barCloseMs);
      const signalId = makeSignalId({ exchange: s.exchange, market, tf: baseTf, barCloseMs });
      const exitEvent = isExitEventName(s.event);
      let signalType = exitEvent ? normalizeEvent(s.event) : mapSignalType(s.event, s.side);
      if (!signalType) signalType = mapSignalType(s.event, s.side);
      if (signalType === "NEG_SAMPLE") continue;
      const eventIdBase = makeEventId({ exchange: s.exchange, market, tf: baseTf, barCloseMs, signalType, event: s.event });
      const eventId = uniqueEventId(eventIdBase);
      const side = normalizeSide(s.side);
      const sideTrade = side === "NEUTRAL" ? "HOLD" : (side === "SHORT" ? "SELL" : "BUY");
      if (!eventIdByBase.has(eventIdBase)) eventIdByBase.set(eventIdBase, eventId);

      signalTypes.add(signalType);
      eventsSet.add(s.event || "");
      if (signalType !== "NEG_SAMPLE") {
        if (!marketsBySignalType[signalType]) marketsBySignalType[signalType] = new Set();
        marketsBySignalType[signalType].add(market);
      }

      let executed = false;
      let execTimeMs = null;
      let execPrice = null;
      const isDropSource = s.source === "drop";
      if (!isDropSource && s.event !== "NEG_SAMPLE") {
        const intentKey = `${s.exchange}|${market}|${baseTf}|${barCloseMs}|${s.event}`;
        const it = intentMap[intentKey];
        if (it) {
          const fill = fillByIntent[it.intent_id];
          if (fill && Number.isFinite(Number(fill.exec_price))) {
            executed = true;
            execTimeMs = Number(fill.exec_bar_close_time_utc_ms || fill._exec_ms || 0) || null;
            execPrice = Number(fill.exec_price);
          }
        }
      }

      const drop = isDropSource || signalType.includes("BLOCK") || signalType.startsWith("COOLDOWN_BLOCK");
      const dropReasonCode = drop
        ? (isDropSource ? (s.drop_reason_code || "DROP_FILTER") : signalType)
        : null;

      let strength = pickFeature(s.features, ["score_norm", "score"]);
      strength = Number.isFinite(Number(strength)) ? Number(strength) : null;
      if (strength != null) {
        if (strength < 0) strength = 0;
        if (strength > 1) strength = 1;
      }
      const aiMeta = (s.features && s.features.ai_signal) ? s.features.ai_signal : null;
      let aiDecision = aiMeta && aiMeta.ai_decision ? String(aiMeta.ai_decision) : null;
      const aiReason = aiMeta && aiMeta.ai_reason ? String(aiMeta.ai_reason) : null;
      if (!aiDecision && dropReasonCode === "AI_BLOCK") {
        aiDecision = "BLOCK";
      }

      signalEvents.push({
        event_id: eventId,
        signal_id: signalId,
        exchange: s.exchange,
        market,
        tf: baseTf,
        bar_close_utc_ms: barCloseMs,
        bar_close_kst: barCloseKst,
        signal_type: signalType,
        side: sideTrade,
        event_intent: s.event_intent || (exitEvent ? "EXIT" : null),
        executed,
        exec_model: "NEXT_OPEN",
        exec_time_utc_ms: execTimeMs,
        exec_time_kst: toKstStringFromMs(execTimeMs),
        exec_price: execPrice,
        keep: drop ? false : true,
        drop: drop ? true : false,
        drop_reason_code: dropReasonCode,
        cooldown_blocked: signalType.startsWith("COOLDOWN_BLOCK"),
        signal_strength: strength,
        signal_reason_text: s.reason || s.event || "",
        signal_reason_code: s.event || "",
        ai_decision: aiDecision,
        ai_reason: aiReason,
      });

      const bars = barsByMarket[market] || [];
      const barIndex = bars.findIndex((b) => b.close_ms === barCloseMs);
      const feat = s.features || {};
      const derivedRegime = (barIndex >= 0) ? computeRegimeState({ bars, idx: barIndex }) : null;
      const derivedTrend = deriveTrendFromRegime(derivedRegime);

      const row = {
        event_id: eventId,
        signal_id: signalId,
        exchange: s.exchange,
        market,
        tf: baseTf,
        bar_close_utc_ms: barCloseMs,
        bar_close_kst: barCloseKst,
        signal_type: signalType,
        side,
        score: pickFeature(feat, ["score"]),
        score_norm: pickFeature(feat, ["score_norm", "scoreNorm"]),
        trend_state: pickFeature(feat, ["trend_state", "trendState"]) || derivedTrend,
        regime_state: pickFeature(feat, ["regime_state", "regimeState"]) || derivedRegime,
        trend_slope: pickFeature(feat, ["trend_slope", "trendSlope"]),
        atr: pickFeature(feat, ["atr"]),
        atr_norm: pickFeature(feat, ["atr_norm", "atrNorm"]),
        htf_rsi: pickFeature(feat, ["htf_rsi", "htfRsi"]),
        htf_state: pickFeature(feat, ["htf_state", "htfState"]),
        td_buy: pickFeature(feat, ["td_buy", "tdBuy"]),
        td_sell: pickFeature(feat, ["td_sell", "tdSell"]),
        td9_prime_state: pickFeature(feat, ["td9_prime_state", "td9PrimeState"]),
        stoch_k: pickFeature(feat, ["stoch_k", "stochK"]),
        stoch_d: pickFeature(feat, ["stoch_d", "stochD"]),
        stoch_state: pickFeature(feat, ["stoch_state", "stochState"]),
        volume_ma: pickFeature(feat, ["volume_ma", "volumeMa"]),
        volume_ratio: pickFeature(feat, ["volume_ratio", "volumeRatio"]),
        vol_class: pickFeature(feat, ["vol_class", "volClass"]),
        band_up: pickFeature(feat, ["band_up", "breakwater_up", "breakwaterBandUp"]),
        band_dn: pickFeature(feat, ["band_dn", "breakwater_dn", "breakwaterBandDn"]),
        band_width: pickFeature(feat, ["band_width", "bandWidth"]),
        inside_bw_zone: pickFeature(feat, ["inside_bw_zone", "insideBwZone"]),
        bw_penalty: pickFeature(feat, ["bw_penalty", "bwPenalty"]),
        session_tag: pickFeature(feat, ["session_tag", "sessionTag"]),
        session_debuff_applied: pickFeature(feat, ["session_debuff_applied", "sessionDebuffApplied"]),
        zz_main_dir: pickFeature(feat, ["zz_main_dir", "zzMainDir"]),
        zz_bull_prob: pickFeature(feat, ["zz_bull_prob", "zzBullProb"]),
        zz_bear_prob: pickFeature(feat, ["zz_bear_prob", "zzBearProb"]),
        zz_wave_conf: pickFeature(feat, ["zz_wave_conf", "zzWaveConf"]),
        zz_wave_dir: pickFeature(feat, ["zz_wave_dir", "zzWaveDir"]),
        zz_phase: pickFeature(feat, ["zz_phase", "zzPhase"]),
        zz_post_prob_long: pickFeature(feat, ["zz_post_prob_long", "zzPostProbLong"]),
        zz_post_prob_short: pickFeature(feat, ["zz_post_prob_short", "zzPostProbShort"]),
        zz_ev_core_long: pickFeature(feat, ["zz_ev_core_long", "zzEvCoreLong"]),
        zz_ev_core_short: pickFeature(feat, ["zz_ev_core_short", "zzEvCoreShort"]),
        zz_ev_real_long: pickFeature(feat, ["zz_ev_real_long", "zzEvRealLong"]),
        zz_ev_real_short: pickFeature(feat, ["zz_ev_real_short", "zzEvRealShort"]),
        ev_thr_core_L: pickFeature(feat, ["ev_thr_core_L", "evThrCoreL"]),
        ev_thr_core_S: pickFeature(feat, ["ev_thr_core_S", "evThrCoreS"]),
        ev_thr_real_L: pickFeature(feat, ["ev_thr_real_L", "evThrRealL"]),
        ev_thr_real_S: pickFeature(feat, ["ev_thr_real_S", "evThrRealS"]),
        zz_conflict_long: pickFeature(feat, ["zz_conflict_long", "zzConflictLong"]),
        zz_conflict_short: pickFeature(feat, ["zz_conflict_short", "zzConflictShort"]),
        tenkan: pickFeature(feat, ["tenkan"]),
        kijun: pickFeature(feat, ["kijun"]),
        span_a: pickFeature(feat, ["span_a", "spanA"]),
        span_b: pickFeature(feat, ["span_b", "spanB"]),
        cloud_state: pickFeature(feat, ["cloud_state", "cloudState"]),
        ichi_bell_fired: pickFeature(feat, ["ichi_bell_fired", "ichiBellFired"]),
        ichi_bell_strength: pickFeature(feat, ["ichi_bell_strength", "ichiBellStrength"]),
        ichi_bell_merged_confidence: pickFeature(feat, ["ichi_bell_merged_confidence", "ichiBellMergedConfidence"]),
        last_same_signal_bars_ago: pickFeature(feat, ["last_same_signal_bars_ago", "lastSameSignalBarsAgo"]),
        gap_applied_value: pickFeature(feat, ["gap_applied_value", "gapAppliedValue"]),
        position_state: pickFeature(feat, ["position_state", "positionState"]),
      };
      signalFeatures.push(row);

      const entryPrice = (s.price != null && Number.isFinite(s.price)) ? Number(s.price) : (barIndex >= 0 ? Number(bars[barIndex].close) : null);
      const sideDir = side === "NEUTRAL" ? "LONG" : side;

      const horizons = [4, 12, 24, 72];
      const labelRow = {
        event_id: eventId,
        signal_id: signalId,
        exchange: s.exchange,
        market,
        tf: baseTf,
        bar_close_utc_ms: barCloseMs,
        bar_close_kst: barCloseKst,
        signal_type: signalType,
        side: sideTrade,
        side_dir: sideDir,
      };

      for (const h of horizons) {
        const idx = barIndex + h;
        const fbar = (barIndex >= 0 && idx < bars.length) ? bars[idx] : null;
        if (fbar && entryPrice) {
          const ret = sideDir === "SHORT" ? ((entryPrice - fbar.close) / entryPrice) : ((fbar.close - entryPrice) / entryPrice);
          labelRow[`fwd_ret_${h}h`] = ret;
        } else {
          labelRow[`fwd_ret_${h}h`] = null;
        }
      }

      const windowBars = (barIndex >= 0) ? bars.slice(barIndex + 1, barIndex + 24 + 1) : [];
      const { mfe, mae } = computeMfeMae({ entry: entryPrice, bars: windowBars, side: sideDir });
      labelRow.fwd_mfe_24h = mfe;
      labelRow.fwd_mae_24h = mae;

      const hit = computeHitTpSl({ entry: entryPrice, bars: windowBars, side: sideDir, rPct: 0.01 });
      labelRow.hit_tp_1R_before_sl = hit.hit;
      labelRow.time_to_tp_1R = hit.tpBars;
      labelRow.time_to_sl_1R = hit.slBars;

      forwardLabels.push(labelRow);
    }

    const activeSignalTypes = new Set(Array.from(signalTypes).filter((t) => t !== "NEG_SAMPLE"));
    const fullSignalTypes = Array.from(new Set([
      ...FULL_SIGNAL_TYPES,
      ...COOLDOWN_SIGNAL_TYPES.map((t) => `COOLDOWN_BLOCK_${t}`),
      ...Array.from(activeSignalTypes),
      ...(activeSignalTypes.has("UNKNOWN_EVENT") ? ["UNKNOWN_EVENT"] : []),
    ]));
    const signalCatalog = buildSignalCatalog(fullSignalTypes, activeSignalTypes, marketsBySignalType);
    const labelsByEvent = {};
    forwardLabels.forEach((l) => { labelsByEvent[l.event_id] = l; });

    function rangeFromMsList(list) {
      const nums = list.filter((x) => Number.isFinite(x));
      if (!nums.length) return null;
      return { min: Math.min(...nums), max: Math.max(...nums) };
    }

    const barTimesAll = Object.values(barsByMarket || {}).flatMap((bars) => bars.map((b) => Number(b.close_ms)));
    const signalTimesAll = signalEvents.map((e) => Number(e.bar_close_utc_ms));
    const fillTimesAll = fillsRaw.map((f) => Number(f.exec_bar_close_time_utc_ms || f._exec_ms));
    const ranges = [rangeFromMsList(barTimesAll), rangeFromMsList(signalTimesAll), rangeFromMsList(fillTimesAll)].filter(Boolean);
    const actualFromMs = ranges.length ? Math.min(...ranges.map((r) => r.min)) : fromMs;
    const actualToMs = ranges.length ? Math.max(...ranges.map((r) => r.max)) : toMsVal;
    const packFromDate = yyyyMmDdUtc(actualFromMs);
    const packToDate = yyyyMmDdUtc(actualToMs);

    const sys = (await getSystemSettingsForProvider(primaryExchangeName || "BINANCEFUT", 0)).data || {};
    const exCfgSnapshot = (await getExchangesSettingsCached(0)).data || {};
    const risk = (await getRiskBudgetForProvider(primaryExchangeName, 0)).data || {};

    function bpsForMarket(map, mk, fallback) {
      if (!map || typeof map !== "object") return fallback;
      const v = map[mk];
      return Number.isFinite(Number(v)) ? Number(v) : fallback;
    }

    // Trade ledger (long/short, costs applied)
    const tradeLedger = [];
    const fillsByMarket = {};
    for (const f of fillsRaw) {
      const mk = f.symbol || f.symbol_or_pair_id || f.market;
      if (!mk) continue;
      if (!fillsByMarket[mk]) fillsByMarket[mk] = [];
      fillsByMarket[mk].push(f);
    }

    for (const [mk, fills] of Object.entries(fillsByMarket)) {
      fills.sort((a, b) => Number(a.exec_bar_close_time_utc_ms || a._exec_ms) - Number(b.exec_bar_close_time_utc_ms || b._exec_ms));
      let posQty = 0;
      let posAvg = null;
      let posSide = null;
      let entryMs = null;
      let entryEventId = null;
      let entrySignalType = null;
      let entryStrategyId = null;
      let entryNotional = 0;
      let entryPrice = null;
      let feesPaid = 0;
      let slippagePaid = 0;
      let tradeId = 0;

      const feeBps = bpsForMarket(sys.fee_bps_by_market, mk, Number(sys.fee_bps || 0));
      const slippageBps = bpsForMarket(sys.slippage_bps_by_market, mk, Number(sys.slippage_bps || 0));
      const fundingBps = Number(process.env.FUNDING_BPS_PER_8H || 0);
      const isFutures = isPrimaryFutures;
      const fundingIndex = isFutures
        ? await buildFundingIndexForFills({ exchange: primaryExchangeName, symbol: mk, fills })
        : null;

      for (const f of fills) {
        const side = String(f.side || "").toUpperCase();
        const px = Number(f.exec_price);
        const qty = Number(f.qty_pct || 0);
        const execMs = Number(f.exec_bar_close_time_utc_ms || f._exec_ms);
        if (!Number.isFinite(px) || !Number.isFinite(execMs) || !Number.isFinite(qty) || qty <= 0) continue;

        const notional = Number(
          f.notional_krw != null
            ? f.notional_krw
            : f.budget_max_krw != null
              ? f.budget_max_krw * qty
              : null
        );
        const fillNotional = Number.isFinite(notional) ? notional : null;
        if (fillNotional != null) {
          const feeVal = (f.fee_value != null) ? Number(f.fee_value) : (fillNotional * (feeBps / 10000));
          if (Number.isFinite(feeVal)) feesPaid += feeVal;
          const slipVal = fillNotional * (slippageBps / 10000);
          if (Number.isFinite(slipVal)) slippagePaid += slipVal;
        }

        if (posQty === 0) {
          const intentId = f.intent_id || null;
          const it = intentId ? (intentById[intentId] || null) : null;
          const strategyId = f.strategy_id || f.strategyId ||
            (it && (it.strategy_id || it.strategyId)) ||
            pickFeature(it && it.features_json, ["strategy_id", "strategyId"]) ||
            DEFAULT_STRATEGY_ID;
          const barMs = resolveSignalBarCloseMs({ intent: it, fill: f, execMs, tf: (it && it.tf) || (f && f.tf) || baseTf });
          const ev = it ? it.event : f.event;
          const sideRaw = it ? it.side : f.side;
          const entrySignalTypeGuess = mapSignalType(ev, sideRaw);
          const isExitSignal = signalPurpose(entrySignalTypeGuess) === "exit";
          if (isExitSignal) {
            continue;
          }

          tradeId += 1;
          posSide = (side === "SELL") ? "SHORT" : "LONG";
          posQty = qty;
          posAvg = px;
          entryMs = execMs;
          entryPrice = px;
          entryStrategyId = strategyId;
          entryNotional = fillNotional || 0;
          const entryEventIdFromFill = f.entry_event_id || null;
          const entrySignalTypeFromFill = f.entry_signal_type || null;
          if (entryEventIdFromFill) {
            entryEventId = entryEventIdFromFill;
            entrySignalType = entrySignalTypeFromFill || entrySignalType;
          } else if (Number.isFinite(barMs) && barMs > 0) {
            const ex = it ? it.exchange : (f.exchange || exchanges[0] || "BINANCEFUT");
            const signalId = makeSignalId({ exchange: ex, market: (it ? it.symbol_or_pair_id : mk), tf: baseTf, barCloseMs: barMs });
            const st = mapSignalType(ev, sideRaw);
            const entryBaseId = makeEventId({ exchange: ex, market: (it ? it.symbol_or_pair_id : mk), tf: baseTf, barCloseMs: barMs, signalType: st, event: ev });
            entryEventId = eventIdByBase.get(entryBaseId) || entryBaseId;
            entrySignalType = st;
          }
          continue;
        }

        if (posSide === "LONG") {
          if (side === "BUY") {
            const nextQty = posQty + qty;
            posAvg = (posAvg * posQty + px * qty) / nextQty;
            posQty = nextQty;
            if (fillNotional != null) entryNotional += fillNotional;
            continue;
          }
          if (side === "SELL") {
            const sellQty = Math.min(qty, posQty);
            posQty -= sellQty;
            if (posQty <= 0) {
              const exitMs = execMs;
              const exitPrice = px;
              const pnlPct = (exitPrice - posAvg) / posAvg;
              const pnlQuote = entryNotional ? (pnlPct * entryNotional) : null;
              const barsHeld = (entryMs != null) ? Math.round((exitMs - entryMs) / baseTfMs) : null;
              const fundingPaid = (isFutures && entryMs != null)
                ? (fundingIndex
                  ? sumFunding(fundingIndex, entryMs, exitMs)
                  : (entryNotional && barsHeld != null)
                    ? (entryNotional * (fundingBps / 10000) * (barsHeld / 8))
                    : 0)
                : 0;
              const netQuote = (pnlQuote != null)
                ? (pnlQuote - feesPaid - slippagePaid - fundingPaid)
                : null;
              const retNet = (netQuote != null && entryNotional)
                ? (netQuote / entryNotional)
                : pnlPct;
              const winFlag = (retNet != null) ? (retNet > 0) : null;

              tradeLedger.push({
                trade_id: `TRADE_${mk}_${tradeId}`,
                exchange: exchanges[0] || "BINANCEFUT",
                market: mk,
                strategy_id: entryStrategyId || DEFAULT_STRATEGY_ID,
                entry_event_id: entryEventId || f.entry_event_id || null,
                entry_signal_type: entrySignalType,
                entry_time_utc_ms: entryMs,
                entry_time_kst: toKstStringFromMs(entryMs),
                entry_price: entryPrice,
                exit_time_utc_ms: exitMs,
                exit_time_kst: toKstStringFromMs(exitMs),
                exit_price: exitPrice,
                exit_event_type: f.event || null,
                qty: sellQty,
                size_notional: entryNotional || null,
                fees_paid: feesPaid || 0,
                slippage_paid: slippagePaid || 0,
                funding_paid: fundingPaid || 0,
                pnl_quote: netQuote,
                ret_net: retNet,
                mfe: null,
                mae: null,
                bars_held: barsHeld,
                win_flag: winFlag,
              });

              posQty = 0;
              posAvg = null;
              posSide = null;
              entryMs = null;
              entryEventId = null;
              entrySignalType = null;
              entryStrategyId = null;
              entryNotional = 0;
              entryPrice = null;
              feesPaid = 0;
              slippagePaid = 0;
            }
          }
        }

        if (posSide === "SHORT") {
          if (side === "SELL") {
            const nextQty = posQty + qty;
            posAvg = (posAvg * posQty + px * qty) / nextQty;
            posQty = nextQty;
            if (fillNotional != null) entryNotional += fillNotional;
            continue;
          }
          if (side === "BUY") {
            const buyQty = Math.min(qty, posQty);
            posQty -= buyQty;
            if (posQty <= 0) {
              const exitMs = execMs;
              const exitPrice = px;
              const pnlPct = (posAvg - exitPrice) / posAvg;
              const pnlQuote = entryNotional ? (pnlPct * entryNotional) : null;
              const barsHeld = (entryMs != null) ? Math.round((exitMs - entryMs) / baseTfMs) : null;
              const fundingPaid = (isFutures && entryMs != null)
                ? (fundingIndex
                  ? sumFunding(fundingIndex, entryMs, exitMs)
                  : (entryNotional && barsHeld != null)
                    ? (entryNotional * (fundingBps / 10000) * (barsHeld / 8))
                    : 0)
                : 0;
              const netQuote = (pnlQuote != null)
                ? (pnlQuote - feesPaid - slippagePaid - fundingPaid)
                : null;
              const retNet = (netQuote != null && entryNotional)
                ? (netQuote / entryNotional)
                : pnlPct;
              const winFlag = (retNet != null) ? (retNet > 0) : null;

              tradeLedger.push({
                trade_id: `TRADE_${mk}_${tradeId}`,
                exchange: exchanges[0] || "BINANCEFUT",
                market: mk,
                strategy_id: entryStrategyId || DEFAULT_STRATEGY_ID,
                entry_event_id: entryEventId || f.entry_event_id || null,
                entry_signal_type: entrySignalType,
                entry_time_utc_ms: entryMs,
                entry_time_kst: toKstStringFromMs(entryMs),
                entry_price: entryPrice,
                exit_time_utc_ms: exitMs,
                exit_time_kst: toKstStringFromMs(exitMs),
                exit_price: exitPrice,
                exit_event_type: f.event || null,
                qty: buyQty,
                size_notional: entryNotional || null,
                fees_paid: feesPaid || 0,
                slippage_paid: slippagePaid || 0,
                funding_paid: fundingPaid || 0,
                pnl_quote: netQuote,
                ret_net: retNet,
                mfe: null,
                mae: null,
                bars_held: barsHeld,
                win_flag: winFlag,
              });

              posQty = 0;
              posAvg = null;
              posSide = null;
              entryMs = null;
              entryEventId = null;
              entrySignalType = null;
              entryStrategyId = null;
              entryNotional = 0;
              entryPrice = null;
              feesPaid = 0;
              slippagePaid = 0;
            }
          }
        }
      }

      // open position snapshot -> record as open trade (no exit yet)
      if (posQty > 0 && entryMs != null) {
        tradeLedger.push({
          trade_id: `TRADE_${mk}_${tradeId}_OPEN`,
          exchange: exchanges[0] || "BINANCEFUT",
          market: mk,
          strategy_id: entryStrategyId || DEFAULT_STRATEGY_ID,
          entry_event_id: entryEventId,
          entry_signal_type: entrySignalType,
          entry_time_utc_ms: entryMs,
          entry_time_kst: toKstStringFromMs(entryMs),
          entry_price: entryPrice,
          exit_time_utc_ms: null,
          exit_time_kst: null,
          exit_price: null,
          exit_event_type: "OPEN",
          qty: posQty,
          size_notional: entryNotional || null,
          fees_paid: feesPaid || 0,
          slippage_paid: slippagePaid || 0,
          funding_paid: null,
          pnl_quote: null,
          ret_net: null,
          mfe: null,
          mae: null,
          bars_held: null,
          win_flag: null,
        });
      }
    }

    function labelRetProxy(lbl) {
      if (!lbl) return { ret: null, src: null };
      const cand = [
        { key: "fwd_ret_24h", val: lbl.fwd_ret_24h },
        { key: "fwd_ret_12h", val: lbl.fwd_ret_12h },
        { key: "fwd_ret_4h", val: lbl.fwd_ret_4h },
        { key: "fwd_ret_72h", val: lbl.fwd_ret_72h },
      ];
      for (const c of cand) {
        const v = Number(c.val);
        if (Number.isFinite(v)) return { ret: v, src: c.key };
      }
      return { ret: null, src: null };
    }

    const labelRows = forwardLabels.filter((l) => l.signal_type !== "NEG_SAMPLE" && isKpiEligibleSignalType(l.signal_type));
    const labelWithRet = labelRows
      .map((l) => {
        const r = labelRetProxy(l);
        if (!Number.isFinite(r.ret)) return null;
        return { ...l, _ret: r.ret, _ret_src: r.src };
      })
      .filter(Boolean);

    // Analysis
    const tradesWithRet = tradeLedger.filter((t) => typeof t.ret_net === "number");
    const useLabelKpi = tradesWithRet.length === 0 && labelWithRet.length > 0;
    const retSeries = useLabelKpi ? labelWithRet.map((l) => l._ret) : tradesWithRet.map((t) => t.ret_net);
    const wins = retSeries.filter((x) => x > 0).length;
    const nTrades = retSeries.length;
    const ev = nTrades ? retSeries.reduce((a, b) => a + b, 0) / nTrades : null;
    const returns = retSeries.slice().sort((a, b) => a - b);
    const p10 = returns.length ? returns[Math.floor((returns.length - 1) * 0.1)] : null;
    const p50 = returns.length ? returns[Math.floor((returns.length - 1) * 0.5)] : null;
    const p90 = returns.length ? returns[Math.floor((returns.length - 1) * 0.9)] : null;
    const worst = returns.length ? returns[0] : null;
    const winRate = nTrades ? (wins / nTrades) : null;
    const ci = wilsonLowerUpper(wins, nTrades, 1.96);
    let mdd = null;
    if (tradesWithRet.length) {
      const sortedByTime = tradesWithRet.slice().sort((a, b) => Number(a.exit_time_utc_ms || 0) - Number(b.exit_time_utc_ms || 0));
      let peak = 0;
      let cum = 0;
      let minDd = 0;
      for (const t of sortedByTime) {
        cum += Number(t.ret_net || 0);
        if (cum > peak) peak = cum;
        const dd = cum - peak;
        if (dd < minDd) minDd = dd;
      }
      mdd = Math.abs(minDd);
    }

    const kpiOverall = {
      trades_n: nTrades,
      win_rate: winRate,
      ev,
      avg_return: ev,
      worst,
      p10,
      p50,
      p90,
      mdd,
      win_rate_ci_95: { lower: ci.lo, upper: ci.hi },
      source: useLabelKpi ? "forward_labels" : "trade_ledger",
      ret_field: useLabelKpi ? (labelWithRet[0]?._ret_src || "fwd_ret_24h") : "ret_net",
    };

    const bySignal = {};
    const marketBySignal = {};
    for (const e of signalEvents) {
      if (!bySignal[e.signal_type]) {
        bySignal[e.signal_type] = { count: 0, executed: 0 };
      }
      bySignal[e.signal_type].count += 1;
      if (e.executed) bySignal[e.signal_type].executed += 1;
      if (!marketBySignal[e.signal_type]) marketBySignal[e.signal_type] = {};
      marketBySignal[e.signal_type][e.market] = (marketBySignal[e.signal_type][e.market] || 0) + 1;
    }

    const tradeBySignal = {};
    if (useLabelKpi) {
      for (const l of labelWithRet) {
        const st = l.signal_type || "UNKNOWN";
        if (!tradeBySignal[st]) tradeBySignal[st] = [];
        tradeBySignal[st].push(l._ret);
      }
    } else {
      for (const t of tradesWithRet) {
        const st = t.entry_signal_type || "UNKNOWN";
        if (!tradeBySignal[st]) tradeBySignal[st] = [];
        tradeBySignal[st].push(t.ret_net);
      }
    }

    const kpiBySignal = [];
    for (const [st, stats] of Object.entries(bySignal)) {
      const arr = tradeBySignal[st] || [];
      const winN = arr.filter((x) => x > 0).length;
      const evS = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
      const sorted = arr.slice().sort((a, b) => a - b);
      const p10s = sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.1)] : null;
      const worstS = sorted.length ? sorted[0] : null;
      const execCount = stats.executed;
      const fillRate = stats.count ? (execCount / stats.count) : null;
      let warningBias = null;
      const mCounts = marketBySignal[st] || {};
      const entries = Object.entries(mCounts);
      if (entries.length) {
        const total = entries.reduce((a, b) => a + b[1], 0);
        const top = entries.sort((a, b) => b[1] - a[1])[0];
        const share = total > 0 ? (top[1] / total) : null;
        if (share != null && share >= 0.7) warningBias = { market: top[0], share };
      }
      kpiBySignal.push({
        signal_type: st,
        count: stats.count,
        executed_count: execCount,
        fill_rate: fillRate,
        win_rate: arr.length ? (winN / arr.length) : null,
        ev: evS,
        avg_return: evS,
        worst: worstS,
        p10: p10s,
        warning_bias: warningBias,
      });
    }

    const kpiByMarket = [];
    const tradeByMarket = {};
    if (useLabelKpi) {
      for (const l of labelWithRet) {
        if (!tradeByMarket[l.market]) tradeByMarket[l.market] = [];
        tradeByMarket[l.market].push(l._ret);
      }
    } else {
      for (const t of tradesWithRet) {
        if (!tradeByMarket[t.market]) tradeByMarket[t.market] = [];
        tradeByMarket[t.market].push(t.ret_net);
      }
    }
    for (const [mk, arr] of Object.entries(tradeByMarket)) {
      const winN = arr.filter((x) => x > 0).length;
      const evS = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
      kpiByMarket.push({
        market: mk,
        trades_n: arr.length,
        win_rate: arr.length ? (winN / arr.length) : null,
        ev: evS,
      });
    }

    const kpiByRegime = [];
    const regimeMap = {};
    for (const f of signalFeatures) {
      if (!f.regime_state) continue;
      regimeMap[f.event_id] = f.regime_state;
    }
    const tradeByRegime = {};
    if (useLabelKpi) {
      for (const l of labelWithRet) {
        const reg = regimeMap[l.event_id] || "UNKNOWN";
        if (!tradeByRegime[reg]) tradeByRegime[reg] = [];
        tradeByRegime[reg].push(l._ret);
      }
    } else {
      for (const t of tradesWithRet) {
        const reg = regimeMap[t.entry_event_id] || "UNKNOWN";
        if (!tradeByRegime[reg]) tradeByRegime[reg] = [];
        tradeByRegime[reg].push(t.ret_net);
      }
    }
    for (const [reg, arr] of Object.entries(tradeByRegime)) {
      const winN = arr.filter((x) => x > 0).length;
      const evS = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
      kpiByRegime.push({
        regime: reg,
        trades_n: arr.length,
        win_rate: arr.length ? (winN / arr.length) : null,
        ev: evS,
      });
    }

    const dist = {};
    function distSummary(key) {
      const vals = signalFeatures.map((r) => Number(r[key])).filter((x) => Number.isFinite(x));
      vals.sort((a, b) => a - b);
      if (!vals.length) return null;
      return {
        n: vals.length,
        p10: vals[Math.floor((vals.length - 1) * 0.1)],
        p50: vals[Math.floor((vals.length - 1) * 0.5)],
        p90: vals[Math.floor((vals.length - 1) * 0.9)],
      };
    }
    dist.score = distSummary("score");
    dist.zz_wave_conf = distSummary("zz_wave_conf");
    dist.band_width = distSummary("band_width");
    dist.volume_ratio = distSummary("volume_ratio");

    function impact(prefix) {
      const dropped = signalEvents.filter((e) => String(e.signal_type).startsWith(prefix));
      const values = dropped
        .map((e) => labelRetProxy(labelsByEvent[e.event_id]).ret)
        .filter((x) => Number.isFinite(Number(x)));
      const avg = values.length ? (values.reduce((a, b) => a + b, 0) / values.length) : null;
      return { dropped_n: dropped.length, avg_fwd_ret_24h: avg };
    }
    function impactByDropReason(prefix) {
      const dropped = signalEvents.filter((e) => String(e.drop_reason_code || "").startsWith(prefix));
      const values = dropped
        .map((e) => labelRetProxy(labelsByEvent[e.event_id]).ret)
        .filter((x) => Number.isFinite(Number(x)));
      const avg = values.length ? (values.reduce((a, b) => a + b, 0) / values.length) : null;
      return { dropped_n: dropped.length, avg_fwd_ret_24h: avg };
    }
    const filterImpact = {
      by_filter: [
        { filter: "EV", ...impact("EV_BLOCK") },
        { filter: "ZZ_WAVE", ...impact("ZZ_WAVE_BLOCK") },
        { filter: "CONFLICT", ...impact("CONFLICT_BLOCK") },
        { filter: "COOLDOWN", ...impact("COOLDOWN_BLOCK") },
        { filter: "DROP_FILTER", ...impactByDropReason("DROP_FILTER") },
      ],
    };

    const walkforward = {
      windows: [],
      note: useLabelKpi
        ? "Simple 4w train / 1w test rollup on labels (bar close time)."
        : "Simple 4w train / 1w test rollup on trades (exit time based).",
    };
    const wfRows = useLabelKpi ? labelWithRet : tradesWithRet;
    const wfTimeKey = useLabelKpi ? "bar_close_utc_ms" : "exit_time_utc_ms";
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    for (let start = fromMs; (start + 5 * weekMs) <= toMsVal; start += weekMs) {
      const trainFrom = start;
      const trainTo = start + 4 * weekMs;
      const testFrom = trainTo;
      const testTo = trainTo + weekMs;
      const testTrades = wfRows.filter((t) => {
        const ts = Number(t[wfTimeKey]);
        return Number.isFinite(ts) && ts >= testFrom && ts < testTo;
      });
      const testWins = testTrades.filter((t) => Number((useLabelKpi ? t._ret : t.ret_net)) > 0).length;
      const testEv = testTrades.length
        ? testTrades.reduce((a, b) => a + Number(useLabelKpi ? b._ret : b.ret_net), 0) / testTrades.length
        : null;
      walkforward.windows.push({
        train_from_utc_ms: trainFrom,
        train_from_kst: toKstStringFromMs(trainFrom),
        train_to_utc_ms: trainTo,
        train_to_kst: toKstStringFromMs(trainTo),
        test_from_utc_ms: testFrom,
        test_from_kst: toKstStringFromMs(testFrom),
        test_to_utc_ms: testTo,
        test_to_kst: toKstStringFromMs(testTo),
        test_trades_n: testTrades.length,
        test_win_rate: testTrades.length ? (testWins / testTrades.length) : null,
        test_ev: testEv,
      });
    }
    if (walkforward.windows.length === 0 && wfRows.length) {
      const times = wfRows.map((t) => Number(t[wfTimeKey])).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
      const minTs = times[0];
      const maxTs = times[times.length - 1];
      if (Number.isFinite(minTs) && Number.isFinite(maxTs) && maxTs > minTs) {
        const split = minTs + Math.floor((maxTs - minTs) * 0.7);
        const testTrades = wfRows.filter((t) => {
          const ts = Number(t[wfTimeKey]);
          return Number.isFinite(ts) && ts >= split && ts <= maxTs;
        });
        const testWins = testTrades.filter((t) => Number((useLabelKpi ? t._ret : t.ret_net)) > 0).length;
        const testEv = testTrades.length
          ? testTrades.reduce((a, b) => a + Number(useLabelKpi ? b._ret : b.ret_net), 0) / testTrades.length
          : null;
        walkforward.windows.push({
          train_from_utc_ms: minTs,
          train_from_kst: toKstStringFromMs(minTs),
          train_to_utc_ms: split,
          train_to_kst: toKstStringFromMs(split),
          test_from_utc_ms: split,
          test_from_kst: toKstStringFromMs(split),
          test_to_utc_ms: maxTs,
          test_to_kst: toKstStringFromMs(maxTs),
          test_trades_n: testTrades.length,
          test_win_rate: testTrades.length ? (testWins / testTrades.length) : null,
          test_ev: testEv,
        });
        walkforward.note += " Fallback window applied due to short range.";
      }
    }

    const signalEventIdSet = new Set(signalEvents.map((e) => e.event_id));
    for (const t of tradeLedger) {
      const entryId = t.entry_event_id;
      if (!entryId || signalEventIdSet.has(entryId)) continue;
      const parts = String(entryId).split("|");
      if (parts.length < 6) continue;
      const [ex, market, tf, barMsRaw, signalType, ...eventParts] = parts;
      const barCloseMs = Number(barMsRaw);
      if (!Number.isFinite(barCloseMs)) continue;
      const event = eventParts.join("|") || signalType;
      const signalId = makeSignalId({ exchange: ex, market, tf, barCloseMs });
      const sideDir = signalDirection(signalType);
      const sideTrade = sideDir === "short" ? "SELL" : sideDir === "long" ? "BUY" : "HOLD";
      const barCloseKst = toKstStringFromMs(barCloseMs);
      const intentLabel = signalPurpose(signalType) === "exit" ? "EXIT" : null;

      signalEvents.push({
        event_id: entryId,
        signal_id: signalId,
        exchange: ex,
        market,
        tf,
        bar_close_utc_ms: barCloseMs,
        bar_close_kst: barCloseKst,
        signal_type: signalType,
        side: sideTrade,
        event_intent: intentLabel,
        executed: true,
        exec_model: "NEXT_OPEN",
        exec_time_utc_ms: Number(t.entry_time_utc_ms || null) || null,
        exec_time_kst: toKstStringFromMs(Number(t.entry_time_utc_ms || null)),
        exec_price: Number(t.entry_price || null) || null,
        keep: true,
        drop: false,
        drop_reason_code: null,
        cooldown_blocked: false,
        signal_strength: null,
        signal_reason_text: "SYNTHETIC_FROM_TRADE",
        signal_reason_code: "SYNTHETIC_FROM_TRADE",
      });

      signalFeatures.push({
        event_id: entryId,
        signal_id: signalId,
        exchange: ex,
        market,
        tf,
        bar_close_utc_ms: barCloseMs,
        bar_close_kst: barCloseKst,
        signal_type: signalType,
        side: sideDir,
      });

      forwardLabels.push({
        event_id: entryId,
        signal_id: signalId,
        exchange: ex,
        market,
        tf,
        bar_close_utc_ms: barCloseMs,
        bar_close_kst: barCloseKst,
        signal_type: signalType,
        side: sideTrade,
        side_dir: sideDir.toUpperCase(),
      });

      signalTypes.add(signalType);
      eventsSet.add(event || "");
      if (signalType !== "NEG_SAMPLE") {
        if (!marketsBySignalType[signalType]) marketsBySignalType[signalType] = new Set();
        marketsBySignalType[signalType].add(market);
      }
      signalEventIdSet.add(entryId);
    }

    const featureNanFields = ["score", "atr", "htf_rsi", "stoch_k", "volume_ratio", "band_width", "zz_wave_conf"];
    const featureNanReport = {
      total_rows: signalFeatures.length,
      fields: {},
    };
    for (const key of featureNanFields) {
      let nanCount = 0;
      for (const row of signalFeatures) {
        const val = row[key];
        if (val === null || val === undefined) {
          nanCount += 1;
          continue;
        }
        const num = Number(val);
        if (!Number.isFinite(num)) nanCount += 1;
      }
      featureNanReport.fields[key] = {
        nan_count: nanCount,
        nan_ratio: signalFeatures.length ? (nanCount / signalFeatures.length) : null,
      };
    }

    const eventIdSet = new Set(signalEvents.map((e) => e.event_id));
    const featureIdSet = new Set(signalFeatures.map((f) => f.event_id));
    const labelIdSet = new Set(forwardLabels.map((l) => l.event_id));
    const eventIdCount = {};
    for (const e of signalEvents) {
      const id = e.event_id;
      eventIdCount[id] = (eventIdCount[id] || 0) + 1;
    }
    const dupEventIds = Object.entries(eventIdCount).filter(([, n]) => n > 1).map(([id]) => id);
    const missingInFeatures = signalEvents.filter((e) => !featureIdSet.has(e.event_id)).map((e) => e.event_id);
    const missingInEvents = signalFeatures.filter((f) => !eventIdSet.has(f.event_id)).map((f) => f.event_id);
    const missingInLabels = signalEvents.filter((e) => !labelIdSet.has(e.event_id)).map((e) => e.event_id);
    const tradeMissingEvent = tradeLedger
      .filter((t) => !t.entry_event_id || !eventIdSet.has(t.entry_event_id))
      .map((t) => t.entry_event_id || "NULL_ENTRY_EVENT_ID");
    const joinIntegrity = {
      signal_events_n: signalEvents.length,
      signal_features_n: signalFeatures.length,
      join_rate: signalEvents.length ? ((signalEvents.length - missingInFeatures.length) / signalEvents.length) : null,
      missing_in_features_n: missingInFeatures.length,
      missing_in_events_n: missingInEvents.length,
      missing_in_features_sample: missingInFeatures.slice(0, 50),
      missing_in_events_sample: missingInEvents.slice(0, 50),
      signal_labels_n: forwardLabels.length,
      label_join_rate: signalEvents.length ? ((signalEvents.length - missingInLabels.length) / signalEvents.length) : null,
      missing_in_labels_n: missingInLabels.length,
      missing_in_labels_sample: missingInLabels.slice(0, 50),
      event_id_duplicates_n: dupEventIds.length,
      event_id_duplicates_sample: dupEventIds.slice(0, 50),
      trade_ledger_n: tradeLedger.length,
      trade_entry_event_link_rate: tradeLedger.length
        ? ((tradeLedger.length - tradeMissingEvent.length) / tradeLedger.length)
        : null,
      trade_missing_event_n: tradeMissingEvent.length,
      trade_missing_event_sample: tradeMissingEvent.slice(0, 50),
    };

    // QA
    dataQuality.integrity = joinIntegrity;
    dataQuality.auto_repair = autoRepair;

    const currentEventIds = signalEvents.map((e) => e.event_id).sort();
    const currentHash = sha256Hex(JSON.stringify(currentEventIds));
    const hashFilePath = process.env.IMPROVEMENT_PACK_HASH_PATH || "/tmp/donbeolja_improvement_pack_last_hash.json";
    const prevHashFile = readJsonSafe(hashFilePath);
    const deterministicPackIdentity = {
      exchanges,
      markets: marketsExpected,
      base_tf: baseTf,
      from_utc: Number.isFinite(actualFromMs) ? new Date(actualFromMs).toISOString() : null,
      to_utc: Number.isFinite(actualToMs) ? new Date(actualToMs).toISOString() : null,
    };
    const {
      deterministic,
      deterministicDiff,
      nextCache: deterministicCache,
    } = buildDeterministicReplayResult({
      currentEventIds,
      currentHash,
      packIdentity: deterministicPackIdentity,
      previousCache: prevHashFile.ok ? prevHashFile.data : null,
      savedAtUtc: nowIso(),
    });
    try {
      fs.writeFileSync(hashFilePath, JSON.stringify(deterministicCache, null, 2), "utf8");
    } catch (e) {
      // ignore cache write failure
    }

    // Build ZIP
    const zip = new JSZip();
    const filesInfo = [];

    function addTextFile(p, text, rows) {
      zip.file(p, text);
      filesInfo.push({ path: p, bytes: Buffer.byteLength(text, "utf8"), rows: rows || null });
    }
    function addGzipFile(p, text, rows) {
      const buf = gzipBuffer(text);
      zip.file(p, buf);
      filesInfo.push({ path: p, bytes: buf.length, rows: rows || null });
    }
    function addCaseFiles(basePath, caseObj, windowBars) {
      addTextFile(`${basePath}/case.json`, JSON.stringify(caseObj, null, 2));
      if (windowBars && windowBars.length) {
        const rows = windowBars.map((b) => ({
          time_open_utc_ms: b.close_ms - baseTfMs,
          time_open_kst: toKstStringFromMs(b.close_ms - baseTfMs),
          time_close_utc_ms: b.close_ms,
          time_close_kst: toKstStringFromMs(b.close_ms),
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
        }));
        const cols = [
          "time_open_utc_ms",
          "time_open_kst",
          "time_close_utc_ms",
          "time_close_kst",
          "open",
          "high",
          "low",
          "close",
          "volume"
        ];
        const csv = toCsv(rows, cols);
        addTextFile(`${basePath}/window_bars.csv`, csv, rows.length);
      }
      addTextFile(`${basePath}/chart_hint.txt`, caseObj.chart_hint || "");
    }

    if (deterministicDiff) {
      addTextFile("qa/diff/event_id_diff.json", JSON.stringify(deterministicDiff, null, 2));
    }

    // meta
    const pinePath =
      process.env.DONBEOLJA_PINE_PATH ||
      process.env.PINE_DONBEOLJA_PATH ||
      path.join(process.cwd(), "code", "donbeolja.pine.txt");
    const zigzagPath =
      process.env.ZIGZAG_PINE_PATH ||
      process.env.PINE_ZIGZAG_PATH ||
      path.join(process.cwd(), "code", "zigzag.pine.txt");

    const pineFile = readFileSafe(pinePath);
    const zigzagFile = readFileSafe(zigzagPath);
    const zigzagEmbedded = !zigzagFile.ok && pineFile.ok && String(pineFile.text || "").includes("ZZ_FUSION");
    const zigzagExtract = zigzagEmbedded ? extractZigzagSections(pineFile.text) : null;
    const dataExchanges = new Set();
    signalsRaw.forEach((x) => dataExchanges.add(String(x.exchange || "").toUpperCase()));
    dropsRaw.forEach((x) => dataExchanges.add(String(x.exchange || "").toUpperCase()));
    intentsRaw.forEach((x) => dataExchanges.add(String(x.exchange || "").toUpperCase()));
    fillsRaw.forEach((x) => dataExchanges.add(String(x.exchange || "").toUpperCase()));
    const missingExchanges = exchanges.filter((ex) => !dataExchanges.has(ex));
    const pineParsed = pineFile.ok
      ? parsePineInputs(pineFile.text, "/code/donbeolja.pine.txt")
      : { registry: [], errors: ["PINE_FILE_MISSING"] };
    const pineInputRegistry = {
      generated_at_utc: nowIso(),
      file: "/code/donbeolja.pine.txt",
      count: pineParsed.registry.length,
      errors: pineParsed.errors || [],
      registry: pineParsed.registry || [],
    };

    const runtimeOverride = {
      source: null,
      inputs: null,
      errors: [],
      unknown_keys: [],
    };
    const runtimeConfigPath = process.env.DONBEOLJA_RUNTIME_CONFIG_PATH || process.env.RUNTIME_CONFIG_PATH || null;
    if (runtimeConfigPath) {
      const res = readJsonSafe(runtimeConfigPath);
      if (res.ok) {
        const inputs = extractRuntimeInputs(res.data);
        if (inputs) {
          runtimeOverride.source = `file:${runtimeConfigPath}`;
          runtimeOverride.inputs = inputs;
        } else {
          runtimeOverride.errors.push("RUNTIME_CONFIG_FILE_NO_INPUTS");
        }
      } else {
        runtimeOverride.errors.push(`RUNTIME_CONFIG_FILE_${res.error}`);
      }
    }
    if (!runtimeOverride.inputs) {
      const runtimeDoc = await db.collection("settings").doc("runtime_config").get();
      if (runtimeDoc.exists) {
        const inputs = extractRuntimeInputs(runtimeDoc.data() || {});
        if (inputs) {
          runtimeOverride.source = "settings/runtime_config";
          runtimeOverride.inputs = inputs;
        } else {
          runtimeOverride.errors.push("SETTINGS_RUNTIME_CONFIG_NO_INPUTS");
        }
      }
    }
    if (!runtimeOverride.inputs) {
      const pineInputsDoc = await db.collection("settings").doc("pine_inputs").get();
      if (pineInputsDoc.exists) {
        const inputs = extractRuntimeInputs(pineInputsDoc.data() || {});
        if (inputs) {
          runtimeOverride.source = "settings/pine_inputs";
          runtimeOverride.inputs = inputs;
        } else {
          runtimeOverride.errors.push("SETTINGS_PINE_INPUTS_NO_INPUTS");
        }
      }
    }

    const pineInputs = {};
    const pineTypes = {};
    for (const r of pineParsed.registry) {
      pineInputs[r.var_name] = r.default_value;
      pineTypes[r.var_name] = r.input_type;
    }
    if (runtimeOverride.inputs) {
      for (const [k, v] of Object.entries(runtimeOverride.inputs)) {
        if (pineInputs[k] === undefined) {
          runtimeOverride.unknown_keys.push(k);
          continue;
        }
        pineInputs[k] = v;
      }
    }

    const derived = {};
    const applied = {};
    const applyFrom = (src, dst) => {
      if (pineInputs[src] === undefined) return;
      if (applied[dst] !== undefined) return;
      applied[dst] = pineInputs[src];
    };
    applyFrom("ev_thr_core", "ev_thr_core_L");
    applyFrom("ev_thr_core", "ev_thr_core_S");
    applyFrom("ev_thr_real", "ev_thr_real_L");
    applyFrom("ev_thr_real", "ev_thr_real_S");
    applyFrom("ev_rr_core", "ev_rr_core_L");
    applyFrom("ev_rr_core", "ev_rr_core_S");
    applyFrom("ev_rr_real", "ev_rr_real_L");
    applyFrom("ev_rr_real", "ev_rr_real_S");
    applyFrom("zz_min_prob", "zz_min_prob_long");
    applyFrom("zz_min_prob", "zz_min_prob_short");

    const runtimeSnapshot = {
      inputs: pineInputs,
      derived,
      applied,
      meta: {
        system: sanitizeConfig(sys),
        exchanges: sanitizeConfig(exCfg),
        risk_budget: sanitizeConfig(risk),
        inputs_source: {
          source: runtimeOverride.source || "pine_defaults",
          override_count: runtimeOverride.inputs ? Object.keys(runtimeOverride.inputs).length : 0,
          unknown_keys: runtimeOverride.unknown_keys,
          errors: runtimeOverride.errors,
        },
        runtime_env: {
          runtime_mode: process.env.RUNTIME_MODE || "local",
          engine_version: process.env.ENGINE_VERSION || "baseline_v0",
        },
      },
    };
    const runtimeSnapshotHash = sha256Hex(JSON.stringify(runtimeSnapshot));

    const pineKeys = pineParsed.registry.map((r) => r.var_name);
    const runtimeKeys = Object.keys(runtimeSnapshot.inputs || {});
    const pineKeySet = new Set(pineKeys);
    const runtimeKeySet = new Set(runtimeKeys);
    const mappingErrors = [];
    for (const k of pineKeys) {
      if (!runtimeKeySet.has(k)) {
        mappingErrors.push({ type: "MISSING_IN_RUNTIME", key: k });
      } else {
        const pineType = pineTypes[k];
        const runtimeType = runtimeTypeForValue(runtimeSnapshot.inputs[k]);
        const normalizedPineType = (pineType === "timeframe" || pineType === "symbol" || pineType === "color") ? "string" : pineType;
        if (normalizedPineType && runtimeType && normalizedPineType !== runtimeType && !(normalizedPineType === "float" && runtimeType === "int")) {
          mappingErrors.push({ type: "TYPE_MISMATCH", key: k, pine_type: pineType, runtime_type: runtimeType });
        }
      }
    }
    for (const k of runtimeKeys) {
      if (!pineKeySet.has(k)) {
        mappingErrors.push({ type: "MISSING_IN_PINE", key: k });
      }
    }
    if (runtimeOverride.unknown_keys.length) {
      mappingErrors.push({
        type: "RUNTIME_OVERRIDE_UNKNOWN_KEYS",
        count: runtimeOverride.unknown_keys.length,
        sample: runtimeOverride.unknown_keys.slice(0, 50),
      });
    }

    const pineToRuntimeMap = {
      generated_at_utc: nowIso(),
      pine_input_count: pineKeys.length,
      runtime_input_count: runtimeKeys.length,
      map: pineKeys.reduce((acc, k) => {
        acc[k] = k;
        return acc;
      }, {}),
      errors: mappingErrors,
      derived_only_keys: Object.keys(runtimeSnapshot.derived || {}),
      applied_only_keys: Object.keys(runtimeSnapshot.applied || {}),
    };

    const allowedKeyPool = pineParsed.registry
      .filter((r) => r.affects_signals && !r.ui_only)
      .map((r) => ({
        key: r.var_name,
        input_type: r.input_type,
        current_value: runtimeSnapshot.inputs[r.var_name],
        delta_max_per_week: calcDeltaMax(r),
        safe_range: (r.constraints?.min != null || r.constraints?.max != null)
          ? [r.constraints?.min ?? null, r.constraints?.max ?? null]
          : null,
        step: r.constraints?.step ?? null,
        affects_signal_types: signalTypesForKey(r.var_name, signalCatalog),
      }));

    const tuningPolicy = {
      weekly_change_limit: {
        max_keys: 2,
        cadence_days: 7,
      },
      allowed_key_pool: allowedKeyPool,
      locked_keys: pineParsed.registry
        .filter((r) => r.ui_only)
        .map((r) => ({ key: r.var_name, reason: r.tuning_lock_reason || "UI_ONLY" })),
    };
    const allowedKeyMap = new Map(allowedKeyPool.map((k) => [k.key, k]));

    const groupMap = {};
    for (const r of pineParsed.registry) {
      const g = r.group_name || "Ungrouped";
      if (!groupMap[g]) groupMap[g] = [];
      groupMap[g].push(r);
    }
    const pineMappingDoc = [
      "# Pine <-> Runtime Config Mapping",
      "",
      `Generated: ${nowIso()}`,
      "",
      ...Object.keys(groupMap).sort().flatMap((g) => {
        const rows = groupMap[g];
        const header = `## ${g}`;
        const table = [
          "| var_name | title_ko | default | type | affects_signals | ui_only | constraints |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          ...rows.map((r) => {
            const constraints = r.constraints && Object.keys(r.constraints).length ? JSON.stringify(r.constraints) : "-";
            return `| ${r.var_name} | ${r.title_ko || "-"} | ${r.default_value ?? "-"} | ${r.input_type} | ${r.affects_signals ? "Y" : "N"} | ${r.ui_only ? "Y" : "N"} | ${constraints} |`;
          }),
        ];
        return [header, "", ...table, ""];
      }),
    ].join("\n");

    const worstSignal = kpiBySignal
      .filter((s) => Number.isFinite(s.ev))
      .slice()
      .sort((a, b) => Number(a.ev) - Number(b.ev))[0] || null;
    const bestSignal = kpiBySignal
      .filter((s) => Number.isFinite(s.ev))
      .slice()
      .sort((a, b) => Number(b.ev) - Number(a.ev))[0] || null;

    const numericAllowed = allowedKeyPool.filter((k) => k.input_type === "int" || k.input_type === "float");
    const numericMap = new Map(numericAllowed.map((k) => [k.key, k]));
    const preferredKeys = [
      "zz_min_prob_long",
      "zz_min_prob_short",
      "zz_min_prob",
      "ev_thr_real",
      "ev_thr_core",
      "ev_rr_real",
      "ev_rr_core",
      "strict_conflict_block",
      "use_mom_filter_real",
      "slope_min",
      "gap_real_base",
      "gap_core_base",
    ];
    function pickKeys(limit) {
      const picks = [];
      for (const k of preferredKeys) {
        if (numericMap.has(k) && !picks.includes(k)) picks.push(k);
        if (picks.length >= limit) break;
      }
      if (picks.length < limit) {
        for (const k of numericMap.keys()) {
          if (!picks.includes(k)) picks.push(k);
          if (picks.length >= limit) break;
        }
      }
      return picks;
    }

    const overallWeak = (kpiOverall.ev != null && kpiOverall.ev < 0) || (kpiOverall.win_rate != null && kpiOverall.win_rate < 0.5);
    const tradeScarce = kpiOverall.trades_n != null && kpiOverall.trades_n < 30;
    const conservativeDirection = "up";
    const aggressiveDirection = overallWeak ? "up" : (tradeScarce ? "down" : "up");

    function buildPatch(name, keys, direction, multiplier) {
      const changes = [];
      for (const key of keys) {
        const reg = pineParsed.registry.find((r) => r.var_name === key);
        const cur = runtimeSnapshot.inputs[key];
        if (!reg || !Number.isFinite(cur)) continue;
        const change = proposeNumericChange(cur, reg, direction, multiplier);
        changes.push({
          key,
          old_value: cur,
          new_value: change.newValue,
          delta: change.delta,
          rationale_metrics: {
            overall_ev: kpiOverall.ev,
            overall_win_rate: kpiOverall.win_rate,
            trades_n: kpiOverall.trades_n,
            worst_signal: worstSignal,
            best_signal: bestSignal,
          },
        });
      }
      return {
        patch_id: `${nowIso().slice(0, 10).replace(/-/g, "")}_${name}_v1`,
        base_version: runtimeSnapshot.meta.runtime_env.engine_version,
        date_range: { from_utc: new Date(fromMs).toISOString(), to_utc: new Date(toMsVal).toISOString() },
        changed_keys: changes.slice(0, 2),
        expected_effect: {
          win_rate_delta_est: direction === "up" ? 0.01 : -0.01,
          precision_delta_est: direction === "up" ? 0.02 : -0.02,
          trades_n_delta_est: direction === "up" ? -0.15 : 0.2,
        },
        guardrails: [
          "OOS win_rate drops by >= 3%p vs baseline",
          "OOS EV drops below baseline",
          "worst or p10 worsens vs baseline",
          "fill_rate decreases by >= 30%",
          "market/regime concentration exceeds 70%",
        ],
        overfit_checks: {
          market_bias_signals: kpiBySignal.filter((s) => s.warning_bias).map((s) => ({ signal_type: s.signal_type, ...s.warning_bias })),
          weak_regimes: kpiByRegime.filter((r) => Number.isFinite(r.ev) && r.ev < 0).map((r) => r.regime),
          walkforward_negative_windows: walkforward.windows.filter((w) => Number.isFinite(w.test_ev) && w.test_ev < 0).length,
        },
      };
    }

    const conservativePatch = buildPatch("conservative", pickKeys(1), conservativeDirection, 1);
    const aggressivePatch = buildPatch("aggressive", pickKeys(2), aggressiveDirection, 1.5);
    const conservativeValidation = validatePatchProposal(conservativePatch, tuningPolicy, allowedKeyMap);
    const aggressiveValidation = validatePatchProposal(aggressivePatch, tuningPolicy, allowedKeyMap);
    conservativePatch.validation = conservativeValidation;
    aggressivePatch.validation = aggressiveValidation;

    const patchBundleProposal = {
      generated_at_utc: nowIso(),
      policy: tuningPolicy.weekly_change_limit,
      validation_summary: {
        conservative_ok: conservativeValidation.ok,
        aggressive_ok: aggressiveValidation.ok,
      },
      proposals: {
        conservative: conservativePatch,
        aggressive: aggressivePatch,
      },
    };

    const pineQuality = await summarizePineSignalQuality({
      signals: signalsRaw,
      fills: fillsRaw,
      exchange: exchanges[0] || null,
      tf: baseTf,
      fromMs: actualFromMs,
      toMs: actualToMs,
    });
    const febtShadowSummary = summarizeFebtByTier(pineQuality && pineQuality.by_tier ? pineQuality.by_tier : {});

    const missingRequired = [];
    if (!pineFile.ok) missingRequired.push("/code/donbeolja.pine.txt");
    if (!zigzagFile.ok && !zigzagEmbedded) missingRequired.push("/code/zigzag.pine.txt");

    const meta = {
      schema: PACK_SCHEMA,
      generated_at_utc: nowIso(),
      range: {
        from_utc: Number.isFinite(actualFromMs) ? new Date(actualFromMs).toISOString() : null,
        to_utc: Number.isFinite(actualToMs) ? new Date(actualToMs).toISOString() : null,
      },
      requested_range: requestedRange,
      timezone_display: "Asia/Seoul",
      base_tf: baseTf,
      exchanges,
      markets: marketsExpected,
      code_fingerprint: {
        donbeolja: {
          name: "donbeolja",
          version_string: "unknown",
          sha256: pineFile.ok ? pineFile.sha256 : "UNAVAILABLE",
          pine_version: "unknown",
          last_modified_utc: pineFile.ok ? pineFile.mtime_utc : null
        },
        zigzag: {
          name: "zigzag",
          version_string: zigzagEmbedded ? "embedded" : "unknown",
          sha256: zigzagFile.ok ? zigzagFile.sha256 : (zigzagEmbedded ? pineFile.sha256 : "UNAVAILABLE"),
          pine_version: "unknown",
          last_modified_utc: zigzagFile.ok ? zigzagFile.mtime_utc : (zigzagEmbedded ? pineFile.mtime_utc : null)
        },
      },
      runtime_fingerprint: {
        preset_mode: process.env.RUNTIME_MODE || "local",
        inputs_snapshot_hash: runtimeSnapshotHash,
        seed: rngSeed,
      },
      execution_model: {
        bar_confirmation: true,
        fill_model: "NEXT_OPEN",
        cost_model_ref: "/config/cost_model.json",
        price_source: "exchange_ohlcv",
      },
      operational_tier_policy: {
        live_entry_taxonomy: ["LONG", "SHORT"],
        timing_profile: "LEGACY_EARLY",
        quantity_profile: "FIXED",
        note: "External live entry events are unified to LONG/SHORT only. Active live source bands are EARLY and CORE; PRE_REAL/REAL are legacy diagnostic bands only.",
      },
      febt_shadow_summary: febtShadowSummary,
      win_definition: {
        win_flag_rule: "ret_net > 0",
        r_unit: "1% of entry price",
      },
      known_issues: [
        ...(missingExchanges.length ? [`No data found for exchanges: ${missingExchanges.join(", ")}`] : []),
        ...(missingRequired.length ? [`Missing required files: ${missingRequired.join(", ")}`] : []),
        ...(pineInputRegistry.errors.length ? [`Pine input parse errors: ${pineInputRegistry.errors.join(", ")}`] : []),
        ...(runtimeOverride.errors.length ? [`Runtime inputs override errors: ${runtimeOverride.errors.join(", ")}`] : []),
      ],
      missing_required: missingRequired,
    };

    const schema = {
      schema_version: PACK_SCHEMA,
      generated_at_utc: meta.generated_at_utc,
      timezone_display: meta.timezone_display,
      base_tf: baseTf,
      runtime_config_schema: {
        inputs: "Pine input.* values mapped 1:1 by var_name",
        derived: "engine derived values (non-input)",
        applied: "directional or market-specific applied thresholds",
      },
      files: {
        "/meta/meta.json": "metadata",
        "/meta/schema.json": "schema",
        "/config/runtime_config.json": "runtime snapshot",
        "/config/cost_model.json": "cost model",
        "/config/risk_budget.json": "risk budget",
        "/config/signal_toggle_matrix.json": "signal toggle matrix",
        "/config/tuning_policy.json": "weekly tuning policy",
        "/mapping/signal_catalog.json": "signal type definitions",
        "/mapping/event_catalog.json": "event definitions",
        "/mapping/field_dictionary.md": "field definitions",
        "/mapping/pine_input_registry.json": "pine input registry",
        "/mapping/pine_to_runtime_config_map.json": "pine runtime mapping",
        "/mapping/pine_config_mapping.md": "pine mapping doc",
        [`/data/bars/{market}/${baseTf}.csv.gz`]: "bars",
        "/data/signals/signal_events.csv.gz": "signal events",
        "/data/signals/signal_features.csv.gz": "signal features",
        "/data/trades/trade_ledger.csv.gz": "trade ledger",
        "/data/labels/signal_forward_labels.csv.gz": "forward labels",
        "/analysis/kpi_overall.json": "overall KPI",
        "/analysis/kpi_by_signal.json": "signal KPI",
        "/analysis/kpi_by_market.json": "market KPI",
        "/analysis/kpi_by_regime.json": "regime KPI",
        "/analysis/pine_signal_quality.json": "pine tier quality summary",
        "/analysis/pine_signal_quality_chain_rows.csv.gz": "pine quality chain rows",
        "/analysis/distributions.json": "distributions",
        "/analysis/filter_impact.json": "filter impact",
        "/analysis/walkforward_summary.json": "walkforward",
        "/analysis/patch_bundle_proposal.json": "patch bundle proposal",
        "/cases/*": "case sets",
        "/qa/data_quality_report.json": "data QA",
        "/qa/deterministic_replay_report.json": "determinism QA",
        "/qa/feature_nan_report.json": "feature NaN ratio report",
        "/prompt/analysis_prompt_ko.txt": "prompt",
        "/README.md": "readme",
      },
    };

    addTextFile("meta/meta.json", JSON.stringify(meta, null, 2));
    addTextFile("meta/schema.json", JSON.stringify(schema, null, 2));

    // code
    addTextFile("code/donbeolja.pine.txt", pineFile.ok ? pineFile.text : "NOT_AVAILABLE\n");
    const zigzagText = zigzagFile.ok
      ? zigzagFile.text
      : (zigzagExtract ? (`// EMBEDDED_IN_DONBEOLJA\n` + zigzagExtract + "\n") : "NOT_AVAILABLE\n");
    addTextFile("code/zigzag.pine.txt", zigzagText);

    // config
    addTextFile("config/runtime_config.json", JSON.stringify(runtimeSnapshot, null, 2));

    addTextFile("config/cost_model.json", JSON.stringify({
      fee_bps: sys.fee_bps ?? 0,
      slippage_bps: sys.slippage_bps ?? 0,
      funding_bps_per_8h: Number(process.env.FUNDING_BPS_PER_8H || 0),
      model: "NEXT_OPEN",
    }, null, 2));

    addTextFile("config/risk_budget.json", JSON.stringify(sanitizeConfig(risk), null, 2));
    addTextFile("config/signal_toggle_matrix.json", JSON.stringify({ note: "Not available. Use signal_catalog + events." }, null, 2));
    addTextFile("config/tuning_policy.json", JSON.stringify(tuningPolicy, null, 2));

    // mapping
    addTextFile("mapping/signal_catalog.json", JSON.stringify(signalCatalog, null, 2));
    addTextFile("mapping/event_catalog.json", JSON.stringify(buildEventCatalog(Array.from(eventsSet)), null, 2));
    addTextFile("mapping/field_dictionary.md", buildFieldDictionary());
    addTextFile("mapping/pine_input_registry.json", JSON.stringify(pineInputRegistry, null, 2));
    addTextFile("mapping/pine_to_runtime_config_map.json", JSON.stringify(pineToRuntimeMap, null, 2));
    addTextFile("mapping/pine_config_mapping.md", pineMappingDoc);

    // bars (STANDARD: full range, MINI: windowed)
    const windowBarsByMarket = {};
    if (level === "MINI") {
      const windowN = Number(process.env.IMPROVEMENT_PACK_WINDOW_BARS || 200);
      for (const [mk, bars] of Object.entries(barsByMarket)) {
        const idxByMs = new Map();
        bars.forEach((b, i) => idxByMs.set(b.close_ms, i));
        const keep = new Set();
        for (const s of mergedSignals) {
          if (s.market !== mk) continue;
          const idx = idxByMs.get(Number(s.bar_close_ms));
          if (idx === undefined) continue;
          const start = Math.max(0, idx - windowN);
          const end = Math.min(bars.length - 1, idx + windowN);
          for (let i = start; i <= end; i += 1) keep.add(bars[i].close_ms);
        }
        windowBarsByMarket[mk] = bars.filter((b) => keep.has(b.close_ms));
      }
    }

    const barsOutput = (level === "MINI") ? windowBarsByMarket : barsByMarket;
    for (const [mk, bars] of Object.entries(barsOutput)) {
      const rows = [];
      let prev = null;
      for (const b of bars) {
        rows.push({
          time_open_utc_ms: b.close_ms - baseTfMs,
          time_open_kst: toKstStringFromMs(b.close_ms - baseTfMs),
          time_close_utc_ms: b.close_ms,
          time_close_kst: toKstStringFromMs(b.close_ms),
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
          vwap: null,
          data_quality_flags: dataQualityFlags(b, prev, baseTfMs),
        });
        prev = b.close_ms;
      }
      const cols = ["time_open_utc_ms","time_open_kst","time_close_utc_ms","time_close_kst","open","high","low","close","volume","vwap","data_quality_flags"];
      const csv = toCsv(rows, cols);
      const p = level === "MINI" ? `data/bars_window/${mk}/window_bars.csv.gz` : `data/bars/${mk}/${baseTf}.csv.gz`;
      addGzipFile(p, csv, rows.length);
    }

    // signals
    const signalCols = [
      "event_id","signal_id","exchange","market","tf","bar_close_utc_ms","bar_close_kst","signal_type","side","event_intent",
      "executed","exec_model","exec_time_utc_ms","exec_time_kst","exec_price","keep","drop","drop_reason_code","cooldown_blocked",
      "signal_strength","signal_reason_text","signal_reason_code","ai_decision","ai_reason"
    ];
    addGzipFile("data/signals/signal_events.csv.gz", toCsv(signalEvents, signalCols), signalEvents.length);

    const featureCols = [
      "event_id","signal_id","exchange","market","tf","bar_close_utc_ms","bar_close_kst","signal_type","side",
      "score","score_norm","trend_state","regime_state","trend_slope","atr","atr_norm","htf_rsi","htf_state",
      "td_buy","td_sell","td9_prime_state","stoch_k","stoch_d","stoch_state","volume_ma","volume_ratio","vol_class",
      "band_up","band_dn","band_width","inside_bw_zone","bw_penalty","session_tag","session_debuff_applied",
      "zz_main_dir","zz_bull_prob","zz_bear_prob","zz_wave_conf","zz_wave_dir","zz_phase",
      "zz_post_prob_long","zz_post_prob_short","zz_ev_core_long","zz_ev_core_short","zz_ev_real_long","zz_ev_real_short",
      "ev_thr_core_L","ev_thr_core_S","ev_thr_real_L","ev_thr_real_S","zz_conflict_long","zz_conflict_short",
      "tenkan","kijun","span_a","span_b","cloud_state","ichi_bell_fired","ichi_bell_strength","ichi_bell_merged_confidence",
      "last_same_signal_bars_ago","gap_applied_value","position_state"
    ];
    addGzipFile("data/signals/signal_features.csv.gz", toCsv(signalFeatures, featureCols), signalFeatures.length);

    const labelCols = [
      "event_id","signal_id","exchange","market","tf","bar_close_utc_ms","bar_close_kst","signal_type","side","side_dir",
      "fwd_ret_4h","fwd_ret_12h","fwd_ret_24h","fwd_ret_72h","fwd_mfe_24h","fwd_mae_24h",
      "hit_tp_1R_before_sl","time_to_tp_1R","time_to_sl_1R"
    ];
    addGzipFile("data/labels/signal_forward_labels.csv.gz", toCsv(forwardLabels, labelCols), forwardLabels.length);

    const tradeCols = [
      "trade_id","exchange","market","strategy_id","entry_event_id","entry_signal_type",
      "entry_time_utc_ms","entry_time_kst","entry_price",
      "exit_time_utc_ms","exit_time_kst","exit_price","exit_event_type",
      "qty","size_notional","fees_paid","slippage_paid","funding_paid",
      "pnl_quote","ret_net","mfe","mae","bars_held","win_flag"
    ];
    addGzipFile("data/trades/trade_ledger.csv.gz", toCsv(tradeLedger, tradeCols), tradeLedger.length);

    const exchangeSet = new Set(exchanges.map((x) => String(x || "").toUpperCase()).filter(Boolean));
    const positions = [];
    for (const exchangeKey of Array.from(exchangeSet)) {
      const readPositions = await listExchangePositionReadViews({ exchange: exchangeKey });
      for (const x of readPositions) {
        if (!isLiveDocForExchange(exchangeKey || (exchanges[0] || "BINANCEFUT"), x)) continue;
        positions.push({
          pos_id: x.pos_id || x.id,
          exchange: x.exchange || null,
          market: x.symbol_or_pair_id || x.symbol || null,
          tf: x.tf || null,
          state: x.state || null,
          size_pct: x.size_pct ?? null,
          avg_price: x.avg_price ?? null,
          updated_at_utc: x.updated_at || null,
          updated_at_kst: toKstStringSafe(x.updated_at || null),
        });
      }
    }
    addTextFile("data/trades/position_snapshots.json", JSON.stringify(positions, null, 2), positions.length);

    // analysis
    addTextFile("analysis/kpi_overall.json", JSON.stringify(kpiOverall, null, 2));
    addTextFile("analysis/kpi_by_signal.json", JSON.stringify(kpiBySignal, null, 2));
    addTextFile("analysis/kpi_by_market.json", JSON.stringify(kpiByMarket, null, 2));
    addTextFile("analysis/kpi_by_regime.json", JSON.stringify(kpiByRegime, null, 2));
    addTextFile("analysis/pine_signal_quality.json", JSON.stringify(pineQuality, null, 2));
    const pineQualityCols = [
      "entry_event_id","exchange","market","tf","tier","entry_signal_type",
      "entry_bar_ms","entry_exec_ms","exits_seen","first_exit_kind","first_exit_event",
      "tp1_hit","sl_before_tp1","trail_after_tp1","realized","realized_ret_net","realized_pnl_quote"
    ];
    addGzipFile(
      "analysis/pine_signal_quality_chain_rows.csv.gz",
      toCsv((pineQuality && Array.isArray(pineQuality.chain_rows)) ? pineQuality.chain_rows : [], pineQualityCols),
      pineQuality && Array.isArray(pineQuality.chain_rows) ? pineQuality.chain_rows.length : 0
    );
    addTextFile("analysis/distributions.json", JSON.stringify(dist, null, 2));
    addTextFile("analysis/filter_impact.json", JSON.stringify(filterImpact, null, 2));
    addTextFile("analysis/walkforward_summary.json", JSON.stringify(walkforward, null, 2));
    addTextFile("analysis/patch_bundle_proposal.json", JSON.stringify(patchBundleProposal, null, 2));

    // cases
    const windowN = Number(process.env.IMPROVEMENT_PACK_CASE_WINDOW_BARS || 200);
    const signalTypeList = Array.from(signalTypes).filter((t) => t !== "NEG_SAMPLE");

    for (const st of signalTypeList) {
      const events = signalEvents.filter((e) => e.signal_type === st);
      const candidates = events
        .map((e) => {
          const lbl = labelsByEvent[e.event_id];
          const r = labelRetProxy(lbl);
          return { e, label: lbl, ret: r.ret, ret_src: r.src };
        })
        .filter((x) => x.label && Number.isFinite(Number(x.ret)));

      const worst = candidates.slice().sort((a, b) => Number(a.ret) - Number(b.ret)).slice(0, 20);
      worst.forEach((x, i) => {
        const e = x.e;
        const lbl = x.label;
        const base = `cases/worst_20_per_signal/${st}/case_${String(i + 1).padStart(2, "0")}`;
        const bars = sliceWindowBars(barsByMarket[e.market] || [], Number(e.bar_close_utc_ms), windowN);
        const caseObj = {
          event_id: e.event_id,
          market: e.market,
          time_close_utc_ms: e.bar_close_utc_ms,
          time_close_kst: e.bar_close_kst,
          summary: `${x.ret_src}=${x.ret}`,
          failure_candidates: [e.drop_reason_code || null].filter(Boolean),
          drop_reason_candidates: [e.drop_reason_code || null].filter(Boolean),
          chart_hint: `exchange=${e.exchange}, market=${e.market}, tf=${baseTf}, bar_close_utc_ms=${e.bar_close_utc_ms}`,
        };
        addCaseFiles(base, caseObj, bars);
      });

      const fp = candidates
        .filter((x) => x.label.hit_tp_1R_before_sl === false || Number(x.ret) < 0)
        .sort((a, b) => Number(a.ret) - Number(b.ret))
        .slice(0, 20);
      fp.forEach((x, i) => {
        const e = x.e;
        const lbl = x.label;
        const base = `cases/false_positive_20_per_signal/${st}/case_${String(i + 1).padStart(2, "0")}`;
        const bars = sliceWindowBars(barsByMarket[e.market] || [], Number(e.bar_close_utc_ms), windowN);
        const caseObj = {
          event_id: e.event_id,
          market: e.market,
          time_close_utc_ms: e.bar_close_utc_ms,
          time_close_kst: e.bar_close_kst,
          summary: `fp ${x.ret_src}=${x.ret}`,
          failure_candidates: [e.drop_reason_code || null].filter(Boolean),
          drop_reason_candidates: [e.drop_reason_code || null].filter(Boolean),
          chart_hint: `exchange=${e.exchange}, market=${e.market}, tf=${baseTf}, bar_close_utc_ms=${e.bar_close_utc_ms}`,
        };
        addCaseFiles(base, caseObj, bars);
      });
    }

    const negCandidates = signalEvents
      .filter((e) => e.signal_type === "NEG_SAMPLE")
      .map((e) => {
        const lbl = labelsByEvent[e.event_id];
        const r = labelRetProxy(lbl);
        return { e, label: lbl, ret: r.ret, ret_src: r.src };
      })
      .filter((x) => x.label && Number.isFinite(Number(x.ret)))
      .sort((a, b) => Number(b.ret) - Number(a.ret))
      .slice(0, 20);
    negCandidates.forEach((x, i) => {
      const e = x.e;
      const lbl = x.label;
      const base = `cases/false_negative_20_per_signal/NEG_SAMPLE/case_${String(i + 1).padStart(2, "0")}`;
      const bars = sliceWindowBars(barsByMarket[e.market] || [], Number(e.bar_close_utc_ms), windowN);
      const caseObj = {
        event_id: e.event_id,
        market: e.market,
        time_close_utc_ms: e.bar_close_utc_ms,
        time_close_kst: e.bar_close_kst,
        summary: `neg sample ${x.ret_src}=${x.ret}`,
        failure_candidates: [],
        drop_reason_candidates: [],
        chart_hint: `exchange=${e.exchange}, market=${e.market}, tf=${baseTf}, bar_close_utc_ms=${e.bar_close_utc_ms}`,
      };
      addCaseFiles(base, caseObj, bars);
    });

    // qa
    addTextFile("qa/data_quality_report.json", JSON.stringify(dataQuality, null, 2));
    addTextFile("qa/deterministic_replay_report.json", JSON.stringify(deterministic, null, 2));
    addTextFile("qa/feature_nan_report.json", JSON.stringify(featureNanReport, null, 2));
    addTextFile("analysis/febt_shadow_summary.json", JSON.stringify(febtShadowSummary, null, 2));

    // prompt
    addTextFile("prompt/analysis_prompt_ko.txt", buildPrompt());

    // README
    const topSignals = kpiBySignal
      .slice()
      .sort((a, b) => Number(b.ev || 0) - Number(a.ev || 0))
      .slice(0, 5)
      .map((x) => `${x.signal_type} (n=${x.count}, ev=${x.ev})`)
      .join(", ");
    const bottomSignals = kpiBySignal
      .slice()
      .sort((a, b) => Number(a.ev || 0) - Number(b.ev || 0))
      .slice(0, 5)
      .map((x) => `${x.signal_type} (n=${x.count}, ev=${x.ev})`)
      .join(", ");
    const readme = [
      "# DONBEOLJA Improvement Pack",
      `- Pack: DONBEOLJA_IMPROVEMENT_PACK__${exchangeParam}__${baseTf}__${packFromDate}__${packToDate}__${packVer}.zip`,
      `- Generated: ${meta.generated_at_utc}`,
      `- Range: ${meta.range.from_utc} -> ${meta.range.to_utc}`,
      `- Requested Range: ${requestedRange.from_utc} -> ${requestedRange.to_utc}`,
      `- Exchanges: ${exchanges.join(", ") || "-"}`,
      `- Markets: ${marketsExpected.length}`,
      "",
      "## Files",
      ...filesInfo.map((f) => `- ${f.path} (${f.bytes} bytes${f.rows != null ? ", rows=" + f.rows : ""})`),
      "",
      "## KPI",
      `- trades_n=${kpiOverall.trades_n}, win_rate=${kpiOverall.win_rate}, ev=${kpiOverall.ev}`,
      `- top signals: ${topSignals || "-"}`,
      `- bottom signals: ${bottomSignals || "-"}`,
      "",
      "## Pine Quality",
      "- Active live source bands: EARLY / CORE",
      "- Legacy diagnostic bands: PRE_REAL / REAL",
      ...["EARLY", "CORE"].map((tier) => {
        const row = pineQuality && pineQuality.by_tier ? pineQuality.by_tier[tier] : null;
        if (!row) return `- ${tier}: unavailable`;
        return `- ${tier}: signals=${row.signals_n}, executed=${row.executed_n}, tp1_hit_rate=${row.tp1_hit_rate}, sl_before_tp1_rate=${row.sl_before_tp1_rate}, trail_capture_rate=${row.trail_capture_rate}, win_rate=${row.win_rate}, avg_ret_net=${row.avg_ret_net}`;
      }),
      `- FEBT shadow: sampled=${febtShadowSummary.sampled_n || 0}, calc_ok=${febtShadowSummary.calc_ok_n || 0}, phase_known=${febtShadowSummary.phase_known_n || 0}, fire=${febtShadowSummary.fire_n || 0}, late=${febtShadowSummary.late_n || 0}, void=${febtShadowSummary.void_n || 0}, disagree=${febtShadowSummary.disagreement_n || 0}, fallback=${febtShadowSummary.fallback_legacy_n || 0}, top_verdict=${febtShadowSummary.top_verdict || "N/A"}`,
      "",
      "## Gate",
      `- data_quality missing=${dataQuality.summary.missing}, delayed=${dataQuality.summary.delayed}, outlier=${dataQuality.summary.outlier}`,
      `- deterministic match=${deterministic.match_pct}`,
      "",
      "## Integrity",
      `- pine_input_registry errors=${pineInputRegistry.errors.length}`,
      `- mapping_errors=${mappingErrors.length}`,
      `- joins signal_events->features rate=${joinIntegrity.join_rate}`,
      `- trade entry_event_id link rate=${joinIntegrity.trade_entry_event_link_rate}`,
      `- missing_required=${missingRequired.length ? missingRequired.join(", ") : "-"}`,
      "",
      "## Notes",
      "- External live entry taxonomy: LONG / SHORT",
      "- LONG/SHORT source timing uses EARLY or CORE",
      "- LONG/SHORT quantity profile is FIXED",
      "- PRE_REAL / REAL are legacy diagnostic bands only",
      `- Level: ${level}`,
      "- Signal features/labels are CSV.GZ (parquet not available)",
      "- Time fields store UTC ms + KST string",
    ].join("\n");
    addTextFile("README.md", readme);

    const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const fileName = `DONBEOLJA_IMPROVEMENT_PACK__${exchangeParam}__${baseTf}__${packFromDate}__${packToDate}__${packVer}.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename=\"${fileName}\"`);
    return res.send(zipBuf);
  } catch (e) {
    return res.status(500).json({ ok: false, error: "IMPROVEMENT_PACK_ERROR", message: e.message });
  }
});

module.exports = router;
