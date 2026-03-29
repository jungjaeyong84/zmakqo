// src/services/signalStandard.js
// 단일 소스: 이벤트 매핑 + 분류 규칙 통합

const SIGNAL_MAPPING_VERSION = "v1";

function normalizeStr(x) {
  return String(x || "").trim();
}

function normalizeEvent(event) {
  const raw = String(event || "").trim().toUpperCase();
  if (!raw) return raw;
  const compact = raw.replace(/[\s-]+/g, "_");
  // Legacy aliases -> canonical names
  if (compact === "LONG_ENTRY") return "LONG";
  if (compact === "SHORT_ENTRY") return "SHORT";
  if (compact === "EL") return "EARLY_LONG";
  if (compact === "ES") return "EARLY_SHORT";
  if (compact === "EARLYL") return "EARLY_LONG";
  if (compact === "EARLYS") return "EARLY_SHORT";
  return compact;
}

function normalizeSide(side) {
  const s = String(side || "").trim().toUpperCase();
  if (s === "LONG") return "BUY";
  if (s === "SHORT") return "SELL";
  if (s === "BUY" || s === "SELL") return s;
  return "HOLD";
}

function sideFromEvent(e) {
  if (!e) return null;
  if (e.endsWith("_LONG") || e.includes("LONG")) return "BUY";
  if (e.endsWith("_SHORT") || e.includes("SHORT")) return "SELL";
  if (e.endsWith("_BUY") || e.includes("_BUY")) return "BUY";
  if (e.endsWith("_SELL") || e.includes("_SELL")) return "SELL";
  return null;
}

function exitSideFromEvent(e) {
  if (!e) return null;
  if (e.includes("SHORT")) return "BUY";
  if (e.includes("LONG")) return "SELL";
  if (e.endsWith("_BUY") || e.includes("_BUY")) return "BUY";
  if (e.endsWith("_SELL") || e.includes("_SELL")) return "SELL";
  return null;
}

const ENTRY_PREFIXES = [
  "EARLY",
  "PRE_REAL",
  "EMO",
  "CORE",
  "REAL",
  "PULLBACK",
  "BREAKOUT",
  "SCALP",
  "GAP",
  "VOL",
  "SS",
  "ICHI_BELL",
];

function isEntryEvent(e) {
  if (!e) return false;
  if (e === "LONG" || e === "SHORT") return true;
  for (const p of ENTRY_PREFIXES) {
    if (e.startsWith(`${p}_`) && (e.endsWith("_LONG") || e.endsWith("_SHORT"))) return true;
  }
  return e.includes("ENTRY");
}

function isAddEvent(e) {
  if (!e) return false;
  if (e.startsWith("ADD_") || e.includes("_ADD_") || e.endsWith("_ADD")) return true;
  if (e.startsWith("HEDGE_")) return true;
  return false;
}

function isExitEvent(e) {
  if (!e) return false;
  if (e.startsWith("EXIT_")) return true;
  if (e.startsWith("TP_") || e.startsWith("SL_")) return true;
  if (e.includes("TAKE_PROFIT") || e.includes("STOP_LOSS")) return true;
  if (e.includes("EXIT")) return true;
  return false;
}

const EXPLICIT_EVENT_MAP = {
  LONG: { intent: "ENTRY", side: "BUY" },
  SHORT: { intent: "ENTRY", side: "SELL" },
  "ICHI BELL LONG": { intent: "ENTRY", side: "BUY" },
  "ICHI BELL SHORT": { intent: "ENTRY", side: "SELL" },
  ICHI_BELL_LONG: { intent: "ENTRY", side: "BUY" },
  ICHI_BELL_SHORT: { intent: "ENTRY", side: "SELL" },
  TD9P_BUY: { intent: "ENTRY", side: "BUY" },
  TD9P_SELL: { intent: "ENTRY", side: "SELL" },
  SS_LONG: { intent: "ENTRY", side: "BUY" },
  SS_SHORT: { intent: "ENTRY", side: "SELL" },
  FORCE_EXIT: { intent: "EXIT", side: null },
  FORCE_EXIT_OVERNIGHT: { intent: "EXIT", side: null },
  FORCE_EXIT_RISK: { intent: "EXIT", side: null },
  FORCE_EXIT_HALF: { intent: "EXIT", side: null },
  FORCE_EXIT_ALL: { intent: "EXIT", side: null },
  EXIT_ALL: { intent: "EXIT", side: null },
  EXIT_FORCE_ALL: { intent: "EXIT", side: null },
  EXIT_CORE_25: { intent: "EXIT", side: null },
  EXIT_REAL_25: { intent: "EXIT", side: null },
  EXIT_LONG: { intent: "EXIT", side: "SELL" },
  EXIT_SHORT: { intent: "EXIT", side: "BUY" },
  EXIT_SL_2P: { intent: "EXIT", side: null },
  EXIT_SL_3P: { intent: "EXIT", side: null },
  EXIT_SL_4P: { intent: "EXIT", side: null },
  EXIT_BE_0P: { intent: "EXIT", side: null },
  EXIT_TP_C_5P: { intent: "EXIT", side: null },
  EXIT_TP_P1_5P: { intent: "EXIT", side: null },
  EXIT_TP_P1_3P: { intent: "EXIT", side: null },
  EXIT_TRAIL_2P: { intent: "EXIT", side: null },
  EXIT_LIQUIDATION_RISK: { intent: "EXIT", side: null },
  EXIT_OPPOSITE_SIGNAL: { intent: "EXIT", side: null },
};

function mapEventToIntentSide(event) {
  const e = normalizeEvent(event);
  if (!e) return { event: e, intent: null, side: null, source: "empty" };

  const explicit = EXPLICIT_EVENT_MAP[e];
  if (explicit) return { event: e, intent: explicit.intent, side: explicit.side, source: "explicit" };

  if (isExitEvent(e)) {
    return { event: e, intent: "EXIT", side: exitSideFromEvent(e), source: "pattern_exit" };
  }
  if (isAddEvent(e)) {
    return { event: e, intent: "ADD", side: sideFromEvent(e) || null, source: "pattern_add" };
  }
  if (isEntryEvent(e)) {
    return { event: e, intent: "ENTRY", side: sideFromEvent(e) || null, source: "pattern_entry" };
  }

  return { event: e, intent: null, side: sideFromEvent(e) || null, source: "unknown" };
}

function resolveEventMapping({ event, side } = {}) {
  const mapping = mapEventToIntentSide(event);
  const incomingSide = normalizeSide(side);
  const expectedSide = mapping.side;

  let finalSide = incomingSide;
  if (finalSide === "HOLD" && expectedSide) finalSide = expectedSide;

  const intentOk = Boolean(mapping.intent);
  const sideOk = expectedSide ? finalSide === expectedSide : finalSide !== "HOLD";

  return {
    ok: intentOk && sideOk,
    event: mapping.event,
    intent: mapping.intent,
    side: finalSide,
    side_expected: expectedSide,
    source: mapping.source,
    reason: !intentOk ? "UNMAPPED_EVENT" : (!sideOk ? "SIDE_MISMATCH" : "OK"),
  };
}

function entryPrefixOf(event) {
  for (const p of ENTRY_PREFIXES) {
    if (event.startsWith(`${p}_`) && (event.endsWith("_LONG") || event.endsWith("_SHORT"))) return p;
  }
  return null;
}

function groupEvent(event) {
  const e = normalizeStr(event).toUpperCase();
  if (!e) return "UNKNOWN";
  if (e === "LONG" || e === "SHORT") return "ENTRY";

  const entryPrefix = entryPrefixOf(e);
  if (entryPrefix) return "ENTRY";

  if (e.startsWith("ADD_") || e.includes("_ADD_") || e.endsWith("_ADD") || e.startsWith("HEDGE_")) return "ADD";

  if (e.includes("EXIT")) return "EXIT";
  if (e.startsWith("TP_") || e.startsWith("SL_") || e.includes("TAKE_PROFIT") || e.includes("STOP_LOSS")) return "EXIT";
  if (e.includes("ENTRY")) return "ENTRY";

  if (e.includes("FORCE")) return e.includes("EXIT") ? "EXIT" : "MISC";

  return "MISC";
}

function subtypeOf(event, group) {
  const e = normalizeStr(event).toUpperCase();

  if (group === "ENTRY") {
    if (e === "LONG" || e === "SHORT") return "LONG_SHORT";
    const entryPrefix = entryPrefixOf(e);
    if (entryPrefix) return entryPrefix;
    if (e.includes("CORE")) return "CORE";
    if (e.includes("REAL")) return "REAL";
    if (e.includes("ADD")) return "ADD";
    return "GEN";
  }

  if (group === "ADD") {
    if (e.startsWith("HEDGE_")) {
      if (e.includes("ON")) return "ON";
      if (e.includes("OFF")) return "OFF";
      return "GEN";
    }
    if (e.includes("ADD")) return "ADD";
    return "GEN";
  }

  if (group === "EXIT") {
    if (e.startsWith("TP_") || e.includes("_TP_") || e.includes("TAKE_PROFIT")) return "TP";
    if (e.startsWith("SL_") || e.includes("_SL_") || e.includes("STOP_LOSS")) return "SL";
    if (e.includes("TRAIL")) return "TRAIL";
    if (e.includes("PARTIAL")) return "PARTIAL";
    if (e.includes("RISK")) return "RISK";
    return "GEN";
  }

  return "GEN";
}

function deriveGroupSubtype(event) {
  const group = groupEvent(event);
  const subtype = subtypeOf(event, group);
  return { group, subtype };
}

function makeDropKey({ side, group, subtype }) {
  return `${normalizeSide(side)}__${String(group || "UNKNOWN").toUpperCase()}__${String(subtype || "GEN").toUpperCase()}`;
}

module.exports = {
  SIGNAL_MAPPING_VERSION,
  normalizeStr,
  normalizeEvent,
  normalizeSide,
  mapEventToIntentSide,
  resolveEventMapping,
  groupEvent,
  subtypeOf,
  deriveGroupSubtype,
  makeDropKey,
};
