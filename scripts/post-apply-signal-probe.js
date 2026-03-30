#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");
const { toKstString, kstDateKey } = require("../src/utils/timeKst");
const { hasFebtContract } = require("../src/utils/febtPayloadContract");

const ROOT = process.cwd();
const OPS_DAILY = path.join(ROOT, "ops", "daily");
const APPROVAL_LATEST_PATH = path.join(OPS_DAILY, "approval_execution_latest.json");
const DEFAULT_THRESHOLD_KST = "2026-02-25 23:00:00 KST";
const DEFAULT_EXCHANGE = "BINANCEFUT";
const ROLE_NAME = "post_apply_signal_observer";

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_err) {
    return null;
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function parseKstToMs(raw) {
  const text = String(raw || "")
    .replace("KST", "")
    .trim();
  const m = text.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!m) return NaN;

  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] || "0");
  return Date.UTC(year, month, day, hour - 9, minute, second, 0);
}

function hhmmFromKst(text) {
  const m = String(text || "").match(/\b(\d{2}):(\d{2})/);
  if (!m) return "0000";
  return `${m[1]}${m[2]}`;
}

function toNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseJsonObject(value) {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (_err) {
    return null;
  }
}

function pickSignalFields(row) {
  if (!row || typeof row !== "object") return null;
  const features = parseJsonObject(row.features_json);
  const tsMs = toNum(row.bar_close_time_utc_ms, null);
  return {
    event: row.event || null,
    strategy_id:
      row.strategy_id ||
      (features && (features.strategy_id || features.strategyId || features._strategy_id_received)) ||
      null,
    symbol:
      row.symbol ||
      row.symbol_or_pair_id ||
      (features && (features.symbol || features.symbol_or_pair_id)) ||
      null,
    bar_close_time_utc_ms: tsMs,
    bar_close_time_kst: tsMs == null ? null : toKstString(tsMs, { fallbackToString: true }),
    trace_payload_version:
      row.trace_payload_version ||
      (features && (features.trace_payload_version || features.tracePayloadVersion)) ||
      null,
    trace_emit_mode:
      row.trace_emit_mode ||
      (features && (features.trace_emit_mode || features.traceEmitMode)) ||
      null,
    trace_chain_key:
      row.trace_chain_key ||
      (features && (features.trace_chain_key || features.traceChainKey)) ||
      null,
    cost_shield_enable: typeof row.cost_shield_enable === "boolean"
      ? row.cost_shield_enable
      : (features && typeof features.cost_shield_enable === "boolean" ? features.cost_shield_enable : null),
    cost_shield_entry_mult: toNum(
      row.cost_shield_entry_mult != null
        ? row.cost_shield_entry_mult
        : (features && (features.cost_shield_entry_mult || features.costShieldEntryMult)),
      null
    ),
    qty_sanitized: typeof row.qty_sanitized === "boolean"
      ? row.qty_sanitized
      : (features && typeof features.qty_sanitized === "boolean" ? features.qty_sanitized : null),
  };
}

async function fetchRange(col, startMs, endMs) {
  const db = getFirestore();
  const out = [];
  const snap = await db
    .collection(col)
    .where("bar_close_time_utc_ms", ">=", startMs)
    .where("bar_close_time_utc_ms", "<=", endMs)
    .get();
  snap.forEach((doc) => out.push(doc.data()));
  return out;
}

function buildDropReasonTop(drops) {
  const map = new Map();
  for (const row of drops) {
    const key = String(row && row.reason ? row.reason : "UNKNOWN");
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));
}

function buildStrategyMismatchTop(drops) {
  const map = new Map();

  for (const row of drops) {
    const reason = String(row && row.reason ? row.reason : "");
    if (reason !== "DROP_STRATEGY_ID_MISMATCH") continue;

    const features = parseJsonObject(row.features_json);
    const received =
      (row && (row._strategy_id_received || row.strategy_id || row.strategyId)) ||
      (features && (features._strategy_id_received || features.strategy_id || features.strategyId)) ||
      null;
    const expected =
      (row && row._strategy_id_default) ||
      (features && features._strategy_id_default) ||
      null;
    const signalId =
      (row && row.signal_id) ||
      (features && features.signal_id) ||
      null;
    const symbol =
      (row && (row.symbol || row.symbol_or_pair_id || row.pair_id)) ||
      (features && (features.symbol || features.symbol_or_pair_id || features.pair_id)) ||
      null;
    const tf = (row && row.tf) || (features && features.tf) || null;

    const key = `${received || "(null)"} -> ${expected || "(null)"}`;
    if (!map.has(key)) {
      map.set(key, {
        received_strategy_id: received,
        expected_strategy_id: expected,
        count: 0,
        symbols: new Set(),
        tfs: new Set(),
        sample_signal_id: signalId || null,
      });
    }

    const item = map.get(key);
    item.count += 1;
    if (symbol) item.symbols.add(symbol);
    if (tf) item.tfs.add(tf);
    if (!item.sample_signal_id && signalId) item.sample_signal_id = signalId;
  }

  return Array.from(map.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((item) => ({
      received_strategy_id: item.received_strategy_id,
      expected_strategy_id: item.expected_strategy_id,
      count: item.count,
      symbols: Array.from(item.symbols).sort(),
      tfs: Array.from(item.tfs).sort(),
      sample_signal_id: item.sample_signal_id,
    }));
}

function buildVerification(signals) {
  let tracePayloadVersionCount = 0;
  let traceEmitModeCount = 0;
  let traceChainKeyCount = 0;
  let febtContractCount = 0;
  let febtTraceContractMissingCount = 0;
  let activeTracePayloadVersionCount = 0;
  let activeFebtContractCount = 0;
  let activeFebtTraceContractMissingCount = 0;
  let costShieldEnableCount = 0;
  let costShieldEntryMultCount = 0;
  let qtySanitizedAnyCount = 0;
  let qtySanitizedTrueCount = 0;

  for (const row of signals) {
    const features = row ? parseJsonObject(row.features_json) : null;
    const event = String((row && row.event) || (features && features.event) || "").trim().toUpperCase();
    const isActiveEntry = ["EARLY_LONG", "EARLY_SHORT", "CORE_LONG", "CORE_SHORT"].includes(event);
    const tracePayloadVersion = row && row.trace_payload_version != null
      ? row.trace_payload_version
      : (features && (features.trace_payload_version || features.tracePayloadVersion));
    const traceEmitMode = row && row.trace_emit_mode != null
      ? row.trace_emit_mode
      : (features && (features.trace_emit_mode || features.traceEmitMode));
    const traceChainKey = row && row.trace_chain_key != null
      ? row.trace_chain_key
      : (features && (features.trace_chain_key || features.traceChainKey));
    const costShieldEnable = row && typeof row.cost_shield_enable === "boolean"
      ? row.cost_shield_enable
      : (features && typeof features.cost_shield_enable === "boolean" ? features.cost_shield_enable : null);
    const costShieldEntryMult = row && row.cost_shield_entry_mult != null
      ? row.cost_shield_entry_mult
      : (features && (features.cost_shield_entry_mult || features.costShieldEntryMult));
    const qtySanitized = row && typeof row.qty_sanitized === "boolean"
      ? row.qty_sanitized
      : (features && typeof features.qty_sanitized === "boolean" ? features.qty_sanitized : null);
    const febtContractPresent = hasFebtContract(features || {});
    const febtTraceContractMissing = row && row._febt_trace_contract_missing === true
      ? true
      : (features && features._febt_trace_contract_missing === true);

    if (tracePayloadVersion != null) tracePayloadVersionCount += 1;
    if (traceEmitMode != null) traceEmitModeCount += 1;
    if (traceChainKey != null) traceChainKeyCount += 1;
    if (febtContractPresent) febtContractCount += 1;
    if (febtTraceContractMissing) febtTraceContractMissingCount += 1;
    if (tracePayloadVersion != null && isActiveEntry) activeTracePayloadVersionCount += 1;
    if (febtContractPresent && isActiveEntry) activeFebtContractCount += 1;
    if (febtTraceContractMissing && isActiveEntry) activeFebtTraceContractMissingCount += 1;
    if (typeof costShieldEnable === "boolean") costShieldEnableCount += 1;
    if (Number.isFinite(Number(costShieldEntryMult))) costShieldEntryMultCount += 1;
    if (typeof qtySanitized === "boolean") {
      qtySanitizedAnyCount += 1;
      if (qtySanitized) qtySanitizedTrueCount += 1;
    }
  }

  return {
    trace_payload_version_count: tracePayloadVersionCount,
    trace_emit_mode_count: traceEmitModeCount,
    trace_chain_key_count: traceChainKeyCount,
    febt_contract_count: febtContractCount,
    febt_trace_contract_missing_count: febtTraceContractMissingCount,
    active_trace_payload_version_count: activeTracePayloadVersionCount,
    active_febt_contract_count: activeFebtContractCount,
    active_febt_trace_contract_missing_count: activeFebtTraceContractMissingCount,
    cost_shield_enable_count: costShieldEnableCount,
    cost_shield_entry_mult_count: costShieldEntryMultCount,
    qty_sanitized_any_count: qtySanitizedAnyCount,
    qty_sanitized_true_count: qtySanitizedTrueCount,
  };
}

function buildMarkdown(payload, jsonPath) {
  const issues = [];
  if (payload.counts.signals === 0) {
    issues.push("[ISSUE] H | post-apply 실신호 0건으로 3분 확정 검증 미착수 | 실신호 유입 전 No-Go 유지");
  }
  if (payload.counts.drops >= 1) {
    const top = payload.drop_reason_top[0];
    issues.push(
      `[ISSUE] H | post-apply 드롭 ${payload.counts.drops}건 (${top ? `${top.reason} ${top.count}건` : "사유 미확인"}) | 전략ID/알림포맷 즉시 점검`
    );
    const mismatchTop = payload.strategy_mismatch_top[0];
    if (mismatchTop) {
      issues.push(
        `[ISSUE] H | 전략ID 불일치 ${mismatchTop.count}건 (수신: ${mismatchTop.received_strategy_id || "null"}, 기준: ${mismatchTop.expected_strategy_id || "null"}) | 기본 전략ID 상수와 Pine strategy_id 동기화 확인`
      );
    }
  }
  if (payload.verification.active_trace_payload_version_count > 0 && payload.verification.active_febt_contract_count === 0) {
    issues.push(
      `[ISSUE] H | active TPTR_V2 신호 ${payload.verification.active_trace_payload_version_count}건에서 FEBT contract 0건 | TradingView 적용본 또는 nested features payload 누락 점검`
    );
  } else if (payload.verification.active_febt_trace_contract_missing_count > 0) {
    issues.push(
      `[ISSUE] M | active TPTR_V2 신호 ${payload.verification.active_febt_trace_contract_missing_count}건이 FEBT contract 없이 수신됨 | webhook top-level backfill 또는 Pine payload branch 점검`
    );
  }
  if (!issues.length) {
    issues.push("[ISSUE] L | post-apply 구간 드롭/누락 없음 | 다음 실신호 3분 검증 대기");
  }

  const firstSignal = payload.first_signal;
  const firstSignalLine = firstSignal
    ? `- 첫 실신호: ${firstSignal.bar_close_time_kst} / ${firstSignal.symbol || "N/A"} / ${firstSignal.event || "N/A"}`
    : "- 첫 실신호: 없음";

  return `# ${payload.date_key} post-apply 실신호 점검 (${ROLE_NAME})

기준 시각: ${payload.generated_at_kst}
산출 JSON: \`${jsonPath}\`
대상 거래소: \`${payload.exchange}\`

## 점검 결과
- 기준 구간: ${payload.window.threshold_kst} ~ ${payload.window.now_kst}
- 신호: \`${payload.counts.signals}\`건
- 드롭: \`${payload.counts.drops}\`건
${firstSignalLine}
- 판정: \`${payload.decision_hint}\`

## 전략ID 불일치 TOP
${payload.strategy_mismatch_top.length
    ? payload.strategy_mismatch_top
      .map(
        (x, i) =>
          `${i + 1}. ${x.received_strategy_id || "null"} -> ${x.expected_strategy_id || "null"} | ${x.count}건 | 심볼 ${x.symbols.join(", ") || "-"}`
      )
      .join("\n")
    : "- 없음"}

## 필드 검증 누적
- trace_payload_version: \`${payload.verification.trace_payload_version_count}\`
- trace_emit_mode: \`${payload.verification.trace_emit_mode_count}\`
- trace_chain_key: \`${payload.verification.trace_chain_key_count}\`
- febt_contract: \`${payload.verification.febt_contract_count}\`
- febt_trace_contract_missing: \`${payload.verification.febt_trace_contract_missing_count}\`
- active tptr/febt/missing: \`${payload.verification.active_trace_payload_version_count}\` / \`${payload.verification.active_febt_contract_count}\` / \`${payload.verification.active_febt_trace_contract_missing_count}\`
- cost_shield_enable: \`${payload.verification.cost_shield_enable_count}\`
- cost_shield_entry_mult: \`${payload.verification.cost_shield_entry_mult_count}\`
- qty_sanitized(true): \`${payload.verification.qty_sanitized_true_count}\`

## 이슈
${issues.join("\n")}

## 지혜 보고 요약
- 독립 실행: post-apply 범위 신호/드롭 직접 재조회 완료
- 의사결정 요청: 전략ID 드롭 누적을 즉시 복구 이슈(H)로 올릴지 확정 필요
- 다음 액션: 실신호 1건 유입 즉시 3분 내 필드 적재 확정 보고 실행
`;
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeText(filePath, text) {
  fs.writeFileSync(filePath, `${text}\n`, "utf8");
}

async function main() {
  ensureDir(OPS_DAILY);

  const nowIso = new Date().toISOString();
  const nowKst = toKstString(nowIso, { fallbackToString: true });
  const dateKey = kstDateKey(nowIso) || "unknown-date";
  const hhmm = hhmmFromKst(nowKst);

  const approval = readJsonSafe(APPROVAL_LATEST_PATH);
  const thresholdKst =
    String(process.env.POST_APPLY_THRESHOLD_KST || "").trim() ||
    approval?.verification_artifact?.post_apply_threshold_kst ||
    DEFAULT_THRESHOLD_KST;
  const thresholdMs = parseKstToMs(thresholdKst);
  if (!Number.isFinite(thresholdMs)) {
    throw new Error(`invalid threshold kst: ${thresholdKst}`);
  }

  const exchange = String(process.env.POST_APPLY_EXCHANGE || DEFAULT_EXCHANGE)
    .trim()
    .toUpperCase();
  const nowMs = Date.now();

  const [signalsAll, dropsAll] = await Promise.all([
    fetchRange("signals", thresholdMs, nowMs),
    fetchRange("signals_dropped", thresholdMs, nowMs),
  ]);

  const signals = signalsAll
    .filter((row) => String(row && row.exchange ? row.exchange : "").toUpperCase() === exchange)
    .sort(
      (a, b) =>
        toNum(a && a.bar_close_time_utc_ms, 0) -
        toNum(b && b.bar_close_time_utc_ms, 0)
    );
  const drops = dropsAll
    .filter((row) => String(row && row.exchange ? row.exchange : "").toUpperCase() === exchange)
    .sort(
      (a, b) =>
        toNum(a && a.bar_close_time_utc_ms, 0) -
        toNum(b && b.bar_close_time_utc_ms, 0)
    );

  const payload = {
    generated_at_iso: nowIso,
    generated_at_kst: nowKst,
    role: ROLE_NAME,
    date_key: dateKey,
    exchange,
    window: {
      threshold_kst: thresholdKst,
      threshold_utc: new Date(thresholdMs).toISOString(),
      now_kst: nowKst,
      now_utc: new Date(nowMs).toISOString(),
    },
    counts: {
      signals: signals.length,
      drops: drops.length,
    },
    first_signal: pickSignalFields(signals[0] || null),
    last_signal: pickSignalFields(signals.length ? signals[signals.length - 1] : null),
    drop_reason_top: buildDropReasonTop(drops),
    strategy_mismatch_top: buildStrategyMismatchTop(drops),
    verification: buildVerification(signals),
    decision_hint: signals.length > 0 ? "FIRST_SIGNAL_DETECTED" : "PENDING_FIRST_SIGNAL",
    source_paths: {
      approval_latest: APPROVAL_LATEST_PATH,
    },
  };

  const datedJsonPath = path.join(
    OPS_DAILY,
    `${dateKey}_post_apply_signal_probe_${hhmm}_jihye.json`
  );
  const latestJsonPath = path.join(OPS_DAILY, "post_apply_signal_probe_latest.json");
  const datedMdPath = path.join(
    OPS_DAILY,
    `${dateKey}_post_apply_signal_probe_${hhmm}_jihye.md`
  );
  const latestMdPath = path.join(OPS_DAILY, "post_apply_signal_probe_latest.md");

  writeJson(datedJsonPath, payload);
  writeJson(latestJsonPath, payload);

  const md = buildMarkdown(payload, datedJsonPath);
  writeText(datedMdPath, md);
  writeText(latestMdPath, md);

  console.log(
    JSON.stringify(
      {
        ok: true,
        output_json: datedJsonPath,
        output_json_latest: latestJsonPath,
        output_md: datedMdPath,
        output_md_latest: latestMdPath,
        decision_hint: payload.decision_hint,
        signals: payload.counts.signals,
        drops: payload.counts.drops,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        role: ROLE_NAME,
        error: err && err.message ? err.message : String(err),
      },
      null,
      2
    )
  );
  process.exit(1);
});
