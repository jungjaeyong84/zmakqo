const { CHARTER_EXPECTATIONS } = require("../config/charterExpectations");
const { SIGNAL_ENGINE_RULES, tpP1ForExchange, getExitRulesForExchange } = require("../engine/signalEngine");
const { SIGNAL_MAPPING_VERSION } = require("./signalStandard");

function nearlyEqual(a, b, eps = 1e-9) {
  if (!Number.isFinite(a) && !Number.isFinite(b)) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= eps;
}

function ratioToPctToken(v, { abs = false, maxDecimals = 2 } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  let pct = (abs ? Math.abs(n) : n) * 100;
  const pow = Math.pow(10, maxDecimals);
  pct = Math.round(pct * pow) / pow;
  const asInt = Math.round(pct);
  if (Math.abs(pct - asInt) < 1e-9) return String(asInt);
  return String(pct).replace(/\.?0+$/, "");
}

function formatPct(v, { sign = false, abs = false, maxDecimals = 2 } = {}) {
  const token = ratioToPctToken(v, { abs, maxDecimals });
  if (token == null) return null;
  let prefix = "";
  if (sign) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) prefix = "+";
  }
  return `${prefix}${token}%`;
}

function formatRuleValue(kind, v) {
  if (kind === "MAPPING_VERSION") return String(v || "-");
  if (kind === "TP_P1_QTY") return Number.isFinite(v) ? formatPct(v, { abs: true }) : "비활성";
  if (kind === "TP_C") return Number.isFinite(v) ? formatPct(v, { sign: true }) : "비활성";
  if (kind === "BE_PCT") return Number.isFinite(v) ? formatPct(v, { sign: true }) : "비활성";
  if (kind === "TRAIL_R_MULTIPLE") return Number.isFinite(v) ? `${String(v).replace(/\.?0+$/, "")}R` : "비활성";
  if (kind === "TRAIL_PCT") return Number.isFinite(v) ? formatPct(v, { abs: true }) : "비활성";
  if (kind === "SL") return Number.isFinite(v) ? formatPct(v) : "비활성";
  if (kind === "TP_P1") return Number.isFinite(v) ? formatPct(v, { sign: true }) : "비활성";
  return String(v ?? "-");
}

function pctId(kind, v, { abs = false } = {}) {
  const token = ratioToPctToken(v, { abs });
  if (token == null) return `${kind}_NA`;
  return `${kind}_${token.replace(/\./g, "_")}P`;
}

function checkCharterConsistency(exchange) {
  const exp = CHARTER_EXPECTATIONS || {};
  const out = [];

  const expEngine = exp.signal_engine || {};
  const expMap = exp.mapping || {};
  const ex = String(exchange || "").toUpperCase();
  const expByEx = (expEngine && expEngine.by_exchange) ? expEngine.by_exchange : {};
  const expDefault = expEngine.default || expEngine;
  const expResolved = expByEx[ex] || expByEx[(ex.includes("BINANCE") ? "BINANCEFUT" : ex)] || expDefault || {};
  const expTp = expResolved.TP_P1;
  const actRules = getExitRulesForExchange(ex);
  const actTp = tpP1ForExchange(ex);

  const slLabel = Number.isFinite(expResolved.SL)
    ? `손절(${formatPct(expResolved.SL)})`
    : "손절";
  out.push({
    id: pctId("SL", expResolved.SL, { abs: true }),
    label: slLabel,
    expected: expResolved.SL,
    actual: actRules.SL,
    expected_label: formatRuleValue("SL", expResolved.SL),
    actual_label: formatRuleValue("SL", actRules.SL),
    ok: nearlyEqual(expResolved.SL, actRules.SL),
  });
  out.push({
    id: pctId("TP_P1", expTp, { abs: true }),
    label: `부분익절(${formatPct(expTp, { sign: true }) || "-"})`,
    expected: expTp,
    actual: actTp,
    expected_label: formatRuleValue("TP_P1", expTp),
    actual_label: formatRuleValue("TP_P1", actTp),
    ok: nearlyEqual(expTp, actTp),
  });
  const tpCLabel = Number.isFinite(expResolved.TP_C)
    ? `전량 익절(${formatPct(expResolved.TP_C, { sign: true })})`
    : "전량 익절(비활성)";
  out.push({
    id: pctId("TP_C", expResolved.TP_C, { abs: true }),
    label: tpCLabel,
    expected: expResolved.TP_C,
    actual: actRules.TP_C,
    expected_label: formatRuleValue("TP_C", expResolved.TP_C),
    actual_label: formatRuleValue("TP_C", actRules.TP_C),
    ok: nearlyEqual(expResolved.TP_C, actRules.TP_C),
  });
  const beLabel = Number.isFinite(expResolved.BE_PCT)
    ? `재손절(${formatPct(expResolved.BE_PCT, { sign: true })})`
    : "재손절(비활성)";
  out.push({
    id: pctId("BE", expResolved.BE_PCT, { abs: true }),
    label: beLabel,
    expected: expResolved.BE_PCT,
    actual: actRules.BE_PCT,
    expected_label: formatRuleValue("BE_PCT", expResolved.BE_PCT),
    actual_label: formatRuleValue("BE_PCT", actRules.BE_PCT),
    ok: nearlyEqual(expResolved.BE_PCT, actRules.BE_PCT),
  });
  const trailLabel = Number.isFinite(expResolved.TRAIL_R_MULTIPLE)
    ? `트레일링(${formatRuleValue("TRAIL_R_MULTIPLE", expResolved.TRAIL_R_MULTIPLE)})`
    : (Number.isFinite(expResolved.TRAIL_PCT)
      ? `트레일링(${formatPct(expResolved.TRAIL_PCT, { abs: true })})`
      : "트레일링(비활성)");
  out.push({
    id: Number.isFinite(expResolved.TRAIL_R_MULTIPLE)
      ? `TRAIL_${String(expResolved.TRAIL_R_MULTIPLE).replace(/\./g, "_")}R`
      : pctId("TRAIL", expResolved.TRAIL_PCT, { abs: true }),
    label: trailLabel,
    expected: Number.isFinite(expResolved.TRAIL_R_MULTIPLE) ? expResolved.TRAIL_R_MULTIPLE : expResolved.TRAIL_PCT,
    actual: Number.isFinite(expResolved.TRAIL_R_MULTIPLE) ? actRules.TRAIL_R_MULTIPLE : actRules.TRAIL_PCT,
    expected_label: Number.isFinite(expResolved.TRAIL_R_MULTIPLE)
      ? formatRuleValue("TRAIL_R_MULTIPLE", expResolved.TRAIL_R_MULTIPLE)
      : formatRuleValue("TRAIL_PCT", expResolved.TRAIL_PCT),
    actual_label: Number.isFinite(expResolved.TRAIL_R_MULTIPLE)
      ? formatRuleValue("TRAIL_R_MULTIPLE", actRules.TRAIL_R_MULTIPLE)
      : formatRuleValue("TRAIL_PCT", actRules.TRAIL_PCT),
    ok: Number.isFinite(expResolved.TRAIL_R_MULTIPLE)
      ? nearlyEqual(expResolved.TRAIL_R_MULTIPLE, actRules.TRAIL_R_MULTIPLE)
      : nearlyEqual(expResolved.TRAIL_PCT, actRules.TRAIL_PCT),
  });
  out.push({
    id: "TP_P1_QTY",
    label: "부분익절 비중",
    expected: expResolved.TP_P1_QTY,
    actual: actRules.TP_P1_QTY,
    expected_label: formatRuleValue("TP_P1_QTY", expResolved.TP_P1_QTY),
    actual_label: formatRuleValue("TP_P1_QTY", actRules.TP_P1_QTY),
    ok: nearlyEqual(expResolved.TP_P1_QTY, actRules.TP_P1_QTY),
  });
  out.push({
    id: "MAPPING_VERSION",
    label: "신호 매핑 버전",
    expected: expMap.SIGNAL_MAPPING_VERSION,
    actual: SIGNAL_MAPPING_VERSION,
    expected_label: formatRuleValue("MAPPING_VERSION", expMap.SIGNAL_MAPPING_VERSION),
    actual_label: formatRuleValue("MAPPING_VERSION", SIGNAL_MAPPING_VERSION),
    ok: String(expMap.SIGNAL_MAPPING_VERSION || "") === String(SIGNAL_MAPPING_VERSION || ""),
  });

  return {
    ok: out.every((c) => c.ok),
    checks: out,
    updated_at: new Date().toISOString(),
  };
}

module.exports = { checkCharterConsistency };
