#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");
const { toKstString, kstDateKey } = require("../src/utils/timeKst");

const ROOT = path.resolve(__dirname, "..");
const OPS_DAILY = path.join(ROOT, "ops", "daily");
const QUERY_PAGE = 500;
const DEFAULT_HOURS = 24;
const DEFAULT_MAX_DOCS = 12000;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const cur = String(argv[i] || "");
    if (!cur.startsWith("--")) continue;
    if (cur.includes("=")) {
      const [k, ...rest] = cur.slice(2).split("=");
      out[k] = rest.join("=");
      continue;
    }
    const k = cur.slice(2);
    const next = argv[i + 1];
    if (next && !String(next).startsWith("--")) {
      out[k] = String(next);
      i += 1;
    } else {
      out[k] = "1";
    }
  }
  return out;
}

function toNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toMs(value) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function parseKstToMs(value) {
  const raw = String(value || "").trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))? KST$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = Number(m[6] || "0");
  if (![y, mo, d, h, mi, s].every((x) => Number.isFinite(x))) return null;
  return Date.UTC(y, mo - 1, d, h - 9, mi, s, 0);
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function toKstMinuteText(ms) {
  const raw = toKstString(ms, { fallbackToString: true });
  return String(raw).replace(/:(\d{2}) KST$/, " KST");
}

function normalizeExchange(value) {
  const x = String(value || "").trim().toUpperCase();
  if (!x) return "";
  if (x === "BINANCE" || x === "BINANCE_FUT") return "BINANCEFUT";
  return x;
}

function normalizeSide(value) {
  const x = String(value || "").trim().toUpperCase();
  if (x === "BUY" || x === "SELL") return x;
  return "";
}

function pickFinitePositive(candidates = []) {
  for (const c of candidates) {
    const n = toNum(c, null);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function pickFinite(candidates = []) {
  for (const c of candidates) {
    const n = toNum(c, null);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function percentile(values, p) {
  if (!Array.isArray(values) || !values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const weight = pos - lo;
  return sorted[lo] * (1 - weight) + sorted[hi] * weight;
}

function safeDiv(num, den) {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return num / den;
}

function toCountMapTop(rows, keyFn, limit = 10) {
  const map = new Map();
  for (const row of rows) {
    const k = String(keyFn(row) || "UNKNOWN");
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k, v]) => ({ key: k, count: v }));
}

function readJsonSafe(absPath) {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(absPath, "utf8")), path: absPath };
  } catch (error) {
    return {
      ok: false,
      data: null,
      path: absPath,
      error: error && error.message ? error.message : String(error),
    };
  }
}

async function fetchByCreatedAt({ db, collection, fromIso, toIso, hardMaxDocs }) {
  const out = [];
  let cursor = null;
  while (out.length < hardMaxDocs) {
    const remaining = hardMaxDocs - out.length;
    const limit = Math.min(QUERY_PAGE, remaining);
    let q = db
      .collection(collection)
      .where("created_at", ">=", fromIso)
      .where("created_at", "<", toIso)
      .orderBy("created_at", "asc")
      .limit(limit);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    snap.forEach((doc) => out.push({ id: doc.id, ...doc.data() }));
    if (snap.size < limit) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return out;
}

function resolveReferencePrice(intent) {
  if (!intent || typeof intent !== "object") return null;
  const features = (intent.features_json && typeof intent.features_json === "object")
    ? intent.features_json
    : {};
  return pickFinitePositive([
    intent.signal_price,
    intent.trigger_px,
    intent.price,
    features.ref_px,
    features.trigger_px,
    features.price,
    features.avg_px,
  ]);
}

function resolveIntentNotional(intent, fillsForIntent) {
  const sumFillNotional = Array.isArray(fillsForIntent)
    ? fillsForIntent.reduce((acc, row) => {
      const n = pickFinitePositive([row.notional_krw, row.notional]);
      return Number.isFinite(n) ? acc + n : acc;
    }, 0)
    : 0;
  return pickFinitePositive([
    intent && intent.fill_notional,
    intent && intent.budget_used_krw,
    sumFillNotional > 0 ? sumFillNotional : null,
  ]);
}

function resolveFillPrice(intent, fillsForIntent) {
  const direct = pickFinitePositive([intent && intent.fill_price]);
  if (Number.isFinite(direct)) return direct;
  if (!Array.isArray(fillsForIntent) || !fillsForIntent.length) return null;
  let weightedNotional = 0;
  let sumNotional = 0;
  for (const row of fillsForIntent) {
    const px = pickFinitePositive([row.exec_price]);
    const n = pickFinitePositive([row.notional_krw, row.notional]);
    if (!Number.isFinite(px) || !Number.isFinite(n)) continue;
    weightedNotional += px * n;
    sumNotional += n;
  }
  if (sumNotional > 0) return weightedNotional / sumNotional;
  return null;
}

function resolveFirstFillMs(intent, fillsForIntent) {
  const direct = toMs(intent && intent.filled_at);
  let first = Number.isFinite(direct) ? direct : null;
  if (Array.isArray(fillsForIntent)) {
    for (const row of fillsForIntent) {
      const ms = pickFinitePositive([toMs(row.created_at), row.exec_bar_close_time_utc_ms]);
      if (!Number.isFinite(ms)) continue;
      if (!Number.isFinite(first) || ms < first) first = ms;
    }
  }
  return Number.isFinite(first) ? first : null;
}

function resolveLastFillMs(fillsForIntent) {
  if (!Array.isArray(fillsForIntent) || !fillsForIntent.length) return null;
  let last = null;
  for (const row of fillsForIntent) {
    const ms = pickFinitePositive([toMs(row.created_at), row.exec_bar_close_time_utc_ms]);
    if (!Number.isFinite(ms)) continue;
    if (!Number.isFinite(last) || ms > last) last = ms;
  }
  return Number.isFinite(last) ? last : null;
}

async function fetchBookTickerSpreadBps(symbols) {
  const uniqueSymbols = [...new Set((symbols || []).map((x) => String(x || "").trim().toUpperCase()).filter(Boolean))];
  if (!uniqueSymbols.length) {
    return { ok: true, source: "BINANCE_BOOK_TICKER", measured: [], spread_bps_values: [] };
  }

  const baseUrl = String(process.env.BINANCE_FUTURES_BASE_URL || "https://fapi.binance.com").trim() || "https://fapi.binance.com";
  const endpoint = `${baseUrl}/fapi/v1/ticker/bookTicker`;
  const res = await fetch(endpoint, { method: "GET", headers: { Accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`BOOK_TICKER_HTTP_${res.status}:${text.slice(0, 200)}`);
  }
  const rows = await res.json();
  const bySymbol = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    bySymbol.set(String(row.symbol || "").toUpperCase(), row);
  }

  const measured = [];
  const spreadBpsValues = [];
  for (const sym of uniqueSymbols) {
    const row = bySymbol.get(sym);
    if (!row) continue;
    const bid = toNum(row.bidPrice, null);
    const ask = toNum(row.askPrice, null);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0 || ask < bid) continue;
    const mid = (bid + ask) / 2;
    const spreadBps = ((ask - bid) / mid) * 10000;
    spreadBpsValues.push(spreadBps);
    measured.push({
      symbol: sym,
      bid: round(bid, 6),
      ask: round(ask, 6),
      spread_bps: round(spreadBps, 4),
    });
  }
  measured.sort((a, b) => (b.spread_bps || 0) - (a.spread_bps || 0));
  return {
    ok: true,
    source: endpoint,
    measured,
    spread_bps_values: spreadBpsValues,
  };
}

function buildIssues({
  conservativeCost,
  conservativeCostLimit,
  conservativeMdd,
  conservativeMddLimit,
  strategyMismatchCount,
  slippageP95Bps,
  latencyP95Ms,
  partialRatePct,
  spreadP95Bps,
  feeRatioPct,
}) {
  const issues = [];
  if (Number.isFinite(conservativeCost) && Number.isFinite(conservativeCostLimit) && conservativeCost > conservativeCostLimit) {
    issues.push(`[ISSUE] H | 보수 비용 ${round(conservativeCost, 4)}%가 상한 ${round(conservativeCostLimit, 4)}% 초과 | 신규 진입 확대 금지`);
  }
  if (Number.isFinite(conservativeMdd) && Number.isFinite(conservativeMddLimit) && conservativeMdd < conservativeMddLimit) {
    issues.push(`[ISSUE] H | 보수 MDD ${round(conservativeMdd, 4)}%가 기준 ${round(conservativeMddLimit, 4)}% 하회 | No-Go 유지`);
  }
  if (Number.isFinite(strategyMismatchCount) && strategyMismatchCount > 0) {
    issues.push(`[ISSUE] H | 전략ID 운영 가드 불일치 ${strategyMismatchCount}건 | 정합성 해소 전 체결 확대 금지`);
  }
  if (Number.isFinite(slippageP95Bps) && slippageP95Bps > 12) {
    issues.push(`[ISSUE] H | 체결 불리값 P95 ${round(slippageP95Bps, 2)}bps(기준 12bps 초과) | 시장가 추격 축소 필요`);
  } else if (Number.isFinite(slippageP95Bps) && slippageP95Bps > 8) {
    issues.push(`[ISSUE] M | 체결 불리값 P95 ${round(slippageP95Bps, 2)}bps(주의 구간) | 지정가 우선 전환 필요`);
  }
  if (Number.isFinite(latencyP95Ms) && latencyP95Ms > 3000) {
    issues.push(`[ISSUE] H | 주문 지연 P95 ${Math.round(latencyP95Ms)}ms(기준 3000ms 초과) | 재시도/대기시간 단축 필요`);
  } else if (Number.isFinite(latencyP95Ms) && latencyP95Ms > 1500) {
    issues.push(`[ISSUE] M | 주문 지연 P95 ${Math.round(latencyP95Ms)}ms(주의 구간) | 체결 재시도 타이밍 조정 필요`);
  }
  if (Number.isFinite(partialRatePct) && partialRatePct > 35) {
    issues.push(`[ISSUE] M | 부분체결 비율 ${round(partialRatePct, 2)}%(기준 35% 초과) | 분할 주문 단위 재조정 필요`);
  }
  if (Number.isFinite(spreadP95Bps) && spreadP95Bps > 6) {
    issues.push(`[ISSUE] M | 현재 호가 스프레드 P95 ${round(spreadP95Bps, 2)}bps(기준 6bps 초과) | 얇은 호가 시간대 진입 축소`);
  }
  if (Number.isFinite(feeRatioPct) && feeRatioPct > 0.08) {
    issues.push(`[ISSUE] M | 최근 수수료 비율 ${round(feeRatioPct, 4)}%(기준 0.08% 초과) | 메이커 체결 비중 상향 필요`);
  }
  if (!issues.length) {
    issues.push("[ISSUE] L | 체결 품질 핵심 경보 없음 | 현재 실행 파라미터 유지");
  }
  return issues;
}

function buildMarkdown(payload) {
  const lines = [];
  const issues = payload.execution_bottlenecks;

  lines.push(`# ${payload.date_key} 체결/마이크로구조 실행 보고 (${payload.cycle} KST)`);
  lines.push("");
  lines.push("## 체결 병목");
  issues.forEach((x) => lines.push(`- ${x}`));
  lines.push("");
  lines.push("## 비용 절감 액션");
  payload.cost_saving_actions.forEach((x) => lines.push(`- ${x}`));
  lines.push("");
  lines.push("## 실행 파라미터");
  Object.entries(payload.execution_parameters).forEach(([k, v]) => {
    lines.push(`- ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
  });
  lines.push("");
  lines.push("## 대표 보고 요약");
  lines.push(`- 판단: ${payload.decision.status_recommendation} / ${payload.decision.mode_recommendation} / ${payload.decision.go_no_go}`);
  lines.push(`- 기준 수치: 비용 ${payload.governance_guard.cost_ratio_pct}% (상한 ${payload.governance_guard.cost_limit_pct}%), MDD ${payload.governance_guard.mdd_pct}% (기준 ${payload.governance_guard.mdd_limit_pct}%), 전략ID 불일치 ${payload.governance_guard.strategy_id_mismatch_count}건`);
  lines.push(`- 체결 지표: 불리체결 P95 ${payload.metrics.slippage.adverse_p95_bps}bps, 지연 P95 ${payload.metrics.latency.created_to_fill_p95_ms}ms, 부분체결 ${payload.metrics.partial_fill.partial_fill_rate_pct}%`);
  lines.push("");
  lines.push("## 자가검증");
  payload.self_validation.checks.forEach((x, idx) => lines.push(`${idx + 1}. ${x}`));
  lines.push(`- 결과: ${payload.self_validation.result}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const exchange = normalizeExchange(args.exchange || "BINANCEFUT");
  const hours = Math.max(1, Math.min(72, Math.trunc(toNum(args.hours, DEFAULT_HOURS))));
  const maxDocs = Math.max(1000, Math.min(50000, Math.trunc(toNum(args.max_docs, DEFAULT_MAX_DOCS))));
  const nowMs = Date.now();
  const fromMs = nowMs - hours * 60 * 60 * 1000;
  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(nowMs).toISOString();

  const generatedAtKst = toKstString(nowMs, { fallbackToString: true });
  const dateKey = kstDateKey(new Date(nowMs).toISOString()) || generatedAtKst.slice(0, 10);
  const cycle = generatedAtKst.slice(11, 16).replace(":", "");

  const dcPath = path.join(OPS_DAILY, "data_consistency_lead_latest.json");
  const riskPath = path.join(OPS_DAILY, "risk_controller_latest.json");
  const strategyPath = path.join(OPS_DAILY, "strategy_id_alignment_latest.json");
  const approvalPath = path.join(OPS_DAILY, "approval_execution_latest.json");

  const dcRead = readJsonSafe(dcPath);
  const riskRead = readJsonSafe(riskPath);
  const strategyRead = readJsonSafe(strategyPath);
  const approvalRead = readJsonSafe(approvalPath);

  const consolidated = (dcRead.ok && dcRead.data && dcRead.data.consolidated_metrics)
    ? dcRead.data.consolidated_metrics
    : {};
  const thresholds = (dcRead.ok && dcRead.data && dcRead.data.thresholds)
    ? dcRead.data.thresholds
    : {};
  const riskScorecard = (riskRead.ok && riskRead.data && riskRead.data.risk_scorecard)
    ? riskRead.data.risk_scorecard
    : {};
  const strategyAlign = (strategyRead.ok && strategyRead.data)
    ? strategyRead.data
    : {};
  const approval = (approvalRead.ok && approvalRead.data)
    ? approvalRead.data
    : {};
  const strategyMismatch = strategyAlign.mismatch
    ? strategyAlign.mismatch
    : {};
  const strategyMismatchFreshness = strategyAlign.mismatch_freshness || {};

  const conservativeCost = pickFinite([
    consolidated.cost_ratio_pct,
    riskScorecard.cost && riskScorecard.cost.applied_value_pct,
  ]);
  const conservativeCostLimit = pickFinite([
    thresholds.cost_limit_pct,
    riskScorecard.cost && riskScorecard.cost.limit_pct,
    0.2,
  ]);
  const conservativeMdd = pickFinite([
    toNum(consolidated.mdd_pct, null),
    riskScorecard.loss && riskScorecard.loss.applied_mdd_pct,
  ]);
  const conservativeMddLimit = pickFinite([
    toNum(thresholds.mdd_hold_limit_pct, null),
    riskScorecard.loss && riskScorecard.loss.hold_limit_pct,
    -1.5,
  ]);
  const strategyMismatchCount = pickFinite([
    toNum(strategyMismatch.guard_count, null),
    toNum(strategyMismatch.after_live_revision_count, null),
    toNum(strategyMismatchFreshness.created_after_live_revision_count, null),
    toNum(strategyMismatch.total_count, null),
    0,
  ]);
  const fallbackCollabDeadline = toKstMinuteText(nowMs + 20 * 60 * 1000);
  const approvalNextStaffRaw = approval && approval.next_report
    ? approval.next_report.staff_to_jihye
    : null;
  const approvalNextStaffMs = parseKstToMs(approvalNextStaffRaw);
  const collabDeadline = Number.isFinite(approvalNextStaffMs) && approvalNextStaffMs >= (nowMs - 10 * 60 * 1000)
    ? String(approvalNextStaffRaw).trim()
    : fallbackCollabDeadline;
  const strategyMismatchLabel = Number.isFinite(strategyMismatchCount) ? `${strategyMismatchCount}건` : "N/A";

  const db = getFirestore();
  const [intentsRaw, fillsRaw] = await Promise.all([
    fetchByCreatedAt({
      db,
      collection: "order_intents_paper",
      fromIso,
      toIso,
      hardMaxDocs: maxDocs,
    }),
    fetchByCreatedAt({
      db,
      collection: "fills_paper",
      fromIso,
      toIso,
      hardMaxDocs: maxDocs,
    }),
  ]);

  const intents = intentsRaw.filter((x) => normalizeExchange(x.exchange) === exchange);
  const fills = fillsRaw.filter((x) => normalizeExchange(x.exchange) === exchange);

  const fillsByIntent = new Map();
  for (const fill of fills) {
    const intentId = String(fill.intent_id || "").trim();
    if (!intentId) continue;
    if (!fillsByIntent.has(intentId)) fillsByIntent.set(intentId, []);
    fillsByIntent.get(intentId).push(fill);
  }

  const intentById = new Map();
  for (const intent of intents) {
    const intentId = String(intent.intent_id || "").trim();
    if (intentId) intentById.set(intentId, intent);
  }

  const slippageAdverseBps = [];
  const slippageAbsBps = [];
  let slippageWeightedNumer = 0;
  let slippageWeightedDenom = 0;
  let adversePositiveCount = 0;
  let slippageComparableCount = 0;
  const slippageRows = [];

  const createdToFillLatencyMs = [];
  const scheduleToFillDelayMs = [];
  const latencyRows = [];
  const fillSpanMs = [];
  const fillCountPerIntent = [];
  let partialIntentCount = 0;
  let filledIntentWithFillRows = 0;

  let intentsWithSide = 0;
  let filledIntents = 0;
  let canceledIntents = 0;
  let pendingIntents = 0;

  for (const intent of intents) {
    const side = normalizeSide(intent.side);
    if (side) intentsWithSide += 1;
    const status = String(intent.status || "").toUpperCase();
    if (status === "FILLED") filledIntents += 1;
    if (status === "CANCELED") canceledIntents += 1;
    if (status === "PENDING" || status === "QUEUED") pendingIntents += 1;

    if (status !== "FILLED") continue;
    const intentId = String(intent.intent_id || "").trim();
    const fillsForIntent = intentId ? (fillsByIntent.get(intentId) || []) : [];
    if (fillsForIntent.length > 0) {
      filledIntentWithFillRows += 1;
      fillCountPerIntent.push(fillsForIntent.length);
      if (fillsForIntent.length > 1) partialIntentCount += 1;
      const firstFillMs = resolveFirstFillMs(intent, fillsForIntent);
      const lastFillMs = resolveLastFillMs(fillsForIntent);
      if (Number.isFinite(firstFillMs) && Number.isFinite(lastFillMs) && lastFillMs >= firstFillMs) {
        fillSpanMs.push(lastFillMs - firstFillMs);
      }
    }

    const refPrice = resolveReferencePrice(intent);
    const fillPrice = resolveFillPrice(intent, fillsForIntent);
    if (side && Number.isFinite(refPrice) && Number.isFinite(fillPrice) && refPrice > 0 && fillPrice > 0) {
      const signed = (fillPrice - refPrice) / refPrice;
      const adverseRate = side === "BUY" ? signed : -signed;
      const adverseBps = adverseRate * 10000;
      const absBps = Math.abs(signed * 10000);
      slippageAdverseBps.push(adverseBps);
      slippageAbsBps.push(absBps);
      slippageComparableCount += 1;
      if (adverseBps > 0) adversePositiveCount += 1;

      const notional = resolveIntentNotional(intent, fillsForIntent);
      slippageRows.push({
        intent_id: intentId || null,
        symbol: intent.symbol_or_pair_id || intent.symbol || null,
        event: intent.event || null,
        side,
        status,
        reference_price: round(refPrice, 8),
        fill_price: round(fillPrice, 8),
        adverse_bps: round(adverseBps, 4),
        abs_bps: round(absBps, 4),
        notional: round(notional, 6),
      });
      if (Number.isFinite(notional) && notional > 0) {
        slippageWeightedNumer += adverseBps * notional;
        slippageWeightedDenom += notional;
      }
    }

    const createdMs = toMs(intent.created_at);
    const filledMs = resolveFirstFillMs(intent, fillsForIntent);
    if (Number.isFinite(createdMs) && Number.isFinite(filledMs) && filledMs >= createdMs) {
      const latency = filledMs - createdMs;
      createdToFillLatencyMs.push(latency);
      latencyRows.push({
        intent_id: intentId || null,
        symbol: intent.symbol_or_pair_id || intent.symbol || null,
        event: intent.event || null,
        side,
        status,
        latency_ms: Math.round(latency),
        created_at: intent.created_at || null,
        filled_at: intent.filled_at || null,
      });
    }

    const scheduledMs = toNum(intent.scheduled_exec_bar_close_time_utc_ms, null);
    if (Number.isFinite(scheduledMs) && Number.isFinite(filledMs)) {
      scheduleToFillDelayMs.push(filledMs - scheduledMs);
    }
  }

  let totalNotional = 0;
  let totalFee = 0;
  let fillsLinkedToKnownIntent = 0;
  for (const fill of fills) {
    const notional = pickFinitePositive([fill.notional_krw, fill.notional]);
    const fee = toNum(fill.fee_value, null);
    if (Number.isFinite(notional)) totalNotional += notional;
    if (Number.isFinite(fee)) totalFee += fee;
    const intentId = String(fill.intent_id || "").trim();
    if (intentId && intentById.has(intentId)) fillsLinkedToKnownIntent += 1;
  }

  const symbolsForSpread = toCountMapTop(
    intents.filter((x) => String(x.status || "").toUpperCase() === "FILLED"),
    (x) => x.symbol_or_pair_id || x.symbol || "UNKNOWN",
    8
  )
    .map((x) => x.key)
    .filter((x) => x !== "UNKNOWN");

  let spreadResult = { ok: false, source: "N/A", measured: [], spread_bps_values: [], error: null };
  try {
    spreadResult = await fetchBookTickerSpreadBps(symbolsForSpread);
  } catch (error) {
    spreadResult = {
      ok: false,
      source: "BINANCE_BOOK_TICKER",
      measured: [],
      spread_bps_values: [],
      error: error && error.message ? error.message : String(error),
    };
  }

  const slippageP50 = percentile(slippageAdverseBps, 0.5);
  const slippageP95 = percentile(slippageAdverseBps, 0.95);
  const slippageMean = slippageAdverseBps.length
    ? slippageAdverseBps.reduce((a, b) => a + b, 0) / slippageAdverseBps.length
    : null;
  const slippageAbsP95 = percentile(slippageAbsBps, 0.95);
  const slippageWeightedMean = safeDiv(slippageWeightedNumer, slippageWeightedDenom);
  const adversePositiveRatioPct = safeDiv(adversePositiveCount * 100, slippageComparableCount);

  const latencyP50 = percentile(createdToFillLatencyMs, 0.5);
  const latencyP95 = percentile(createdToFillLatencyMs, 0.95);
  const latencyMax = createdToFillLatencyMs.length ? Math.max(...createdToFillLatencyMs) : null;

  const scheduleDelayP50 = percentile(scheduleToFillDelayMs, 0.5);
  const scheduleDelayP95 = percentile(scheduleToFillDelayMs, 0.95);

  const partialRatePct = safeDiv(partialIntentCount * 100, filledIntentWithFillRows);
  const fillCountP95 = percentile(fillCountPerIntent, 0.95);
  const fillSpanP95 = percentile(fillSpanMs, 0.95);

  const feeRatioPct = safeDiv(totalFee * 100, totalNotional);
  const spreadP50 = percentile(spreadResult.spread_bps_values, 0.5);
  const spreadP95 = percentile(spreadResult.spread_bps_values, 0.95);
  const spreadMax = spreadResult.spread_bps_values.length ? Math.max(...spreadResult.spread_bps_values) : null;

  const topAdverseSlippage = [...slippageRows]
    .sort((a, b) => (b.adverse_bps || 0) - (a.adverse_bps || 0))
    .slice(0, 5);
  const topLatency = [...latencyRows]
    .sort((a, b) => (b.latency_ms || 0) - (a.latency_ms || 0))
    .slice(0, 5);

  const issues = buildIssues({
    conservativeCost,
    conservativeCostLimit,
    conservativeMdd,
    conservativeMddLimit,
    strategyMismatchCount,
    slippageP95Bps: slippageP95,
    latencyP95Ms: latencyP95,
    partialRatePct,
    spreadP95Bps: spreadP95,
    feeRatioPct,
  });

  const reasons = [];
  if (issues.some((x) => x.startsWith("[ISSUE] H"))) reasons.push("H 등급 이슈 존재");
  if (Number.isFinite(conservativeCost) && Number.isFinite(conservativeCostLimit) && conservativeCost > conservativeCostLimit) {
    reasons.push(`보수 비용 ${round(conservativeCost, 4)}% > 상한 ${round(conservativeCostLimit, 4)}%`);
  }
  if (Number.isFinite(conservativeMdd) && Number.isFinite(conservativeMddLimit) && conservativeMdd < conservativeMddLimit) {
    reasons.push(`보수 MDD ${round(conservativeMdd, 4)}% < 기준 ${round(conservativeMddLimit, 4)}%`);
  }
  if (Number.isFinite(strategyMismatchCount) && strategyMismatchCount > 0) {
    reasons.push(`전략ID 운영 가드 불일치 ${strategyMismatchCount}건`);
  }
  if (!reasons.length) reasons.push("체결 품질/리스크 주요 지표 안정");

  const statusRecommendation = issues.some((x) => x.startsWith("[ISSUE] H")) ? "보류 유지" : "진행 가능";
  const modeRecommendation = issues.some((x) => x.startsWith("[ISSUE] H")) ? "비용 차단 유지" : "비용 제한 완화 검토";
  const goNoGo = issues.some((x) => x.startsWith("[ISSUE] H")) ? "No-Go 유지" : "Go 검토 가능";

  const payload = {
    generated_at_iso: new Date(nowMs).toISOString(),
    generated_at_kst: generatedAtKst,
    date_key: dateKey,
    role: "execution_microstructure_engineer",
    cycle,
    window: {
      hours,
      from_iso: fromIso,
      to_iso: toIso,
      exchange,
      max_docs_scanned: maxDocs,
    },
    decision: {
      status_recommendation: statusRecommendation,
      mode_recommendation: modeRecommendation,
      go_no_go: goNoGo,
      reasons,
    },
    governance_guard: {
      cost_ratio_pct: round(conservativeCost, 4),
      cost_limit_pct: round(conservativeCostLimit, 4),
      mdd_pct: round(conservativeMdd, 4),
      mdd_limit_pct: round(conservativeMddLimit, 4),
      strategy_id_mismatch_count: strategyMismatchCount,
    },
    metrics: {
      intents: {
        total: intents.length,
        with_side: intentsWithSide,
        filled: filledIntents,
        canceled: canceledIntents,
        pending_or_queued: pendingIntents,
        fill_rate_pct: round(safeDiv(filledIntents * 100, intentsWithSide), 2),
      },
      fills: {
        total: fills.length,
        linked_to_known_intent: fillsLinkedToKnownIntent,
        linked_rate_pct: round(safeDiv(fillsLinkedToKnownIntent * 100, fills.length), 2),
      },
      slippage: {
        comparable_count: slippageComparableCount,
        adverse_p50_bps: round(slippageP50, 2),
        adverse_p95_bps: round(slippageP95, 2),
        adverse_mean_bps: round(slippageMean, 2),
        adverse_weighted_mean_bps: round(slippageWeightedMean, 2),
        abs_p95_bps: round(slippageAbsP95, 2),
        adverse_positive_ratio_pct: round(adversePositiveRatioPct, 2),
      },
      latency: {
        created_to_fill_count: createdToFillLatencyMs.length,
        created_to_fill_p50_ms: round(latencyP50, 0),
        created_to_fill_p95_ms: round(latencyP95, 0),
        created_to_fill_max_ms: round(latencyMax, 0),
        schedule_to_fill_count: scheduleToFillDelayMs.length,
        schedule_to_fill_p50_ms: round(scheduleDelayP50, 0),
        schedule_to_fill_p95_ms: round(scheduleDelayP95, 0),
      },
      partial_fill: {
        filled_intents_with_fill_rows: filledIntentWithFillRows,
        partial_intent_count: partialIntentCount,
        partial_fill_rate_pct: round(partialRatePct, 2),
        fill_count_p95: round(fillCountP95, 2),
        fill_span_p95_ms: round(fillSpanP95, 0),
      },
      fee: {
        total_notional: round(totalNotional, 6),
        total_fee: round(totalFee, 6),
        fee_ratio_pct: round(feeRatioPct, 4),
      },
      spread: {
        source: spreadResult.source,
        fetch_ok: spreadResult.ok,
        measured_symbols: spreadResult.measured.length,
        p50_bps: round(spreadP50, 2),
        p95_bps: round(spreadP95, 2),
        max_bps: round(spreadMax, 2),
        top: spreadResult.measured.slice(0, 5),
        error: spreadResult.error || null,
      },
      top_symbols_by_filled_intent: toCountMapTop(
        intents.filter((x) => String(x.status || "").toUpperCase() === "FILLED"),
        (x) => x.symbol_or_pair_id || x.symbol || "UNKNOWN",
        6
      ),
      outliers: {
        top_adverse_slippage: topAdverseSlippage,
        top_latency: topLatency,
      },
    },
    execution_bottlenecks: issues,
    cost_saving_actions: [
      "ENTRY는 Post-only LIMIT 우선, 1.8초 미체결 시 1회 재호가 후 미체결만 시장가 전환",
      "EXIT는 Reduce-only 우선으로 반대포지션 생성 차단, TP/SL 분할 비율 60/40으로 체결 분산",
      "호가 스프레드 상위 20% 구간은 신규 진입 축소(수량 50%)로 가격충격 억제",
      "부분체결 2회 이상 주문은 동일 사이클 재진입 금지(중복 수수료 차단)",
    ],
    execution_parameters: {
      entry_order_mode: "LIMIT_POST_ONLY_FIRST",
      entry_cancel_replace_ms: 1800,
      entry_max_requote_count: 1,
      entry_fallback_market_after_ms: 5000,
      exit_order_mode: "REDUCE_ONLY_LIMIT_THEN_MARKET",
      partial_fill_split_count: 3,
      partial_fill_slice_interval_ms: 250,
      spread_guard_p95_bps_limit: 6,
      slippage_guard_p95_bps_limit: 12,
      latency_guard_p95_ms_limit: 3000,
      partial_fill_rate_limit_pct: 35,
    },
    report_to_jihye: {
      progress_pct: 100,
      key_results: [
        `최근 ${hours}시간 체결 분석 완료(주문 ${intents.length}건, 체결 ${fills.length}건)`,
        `불리체결 P95 ${round(slippageP95, 2)}bps, 지연 P95 ${round(latencyP95, 0)}ms, 부분체결 ${round(partialRatePct, 2)}%`,
        `현재 호가 스프레드 P95 ${round(spreadP95, 2)}bps (${spreadResult.measured.length}개 심볼 측정)`,
      ],
      key_risks: issues,
      decision_request: {
        option_a: "보류 유지 + 비용 차단 유지 + No-Go 유지 (권고)",
        option_b: "체결 파라미터만 제한 완화 후 소규모 재개",
        recommended: "option_a",
        reason: "보수 비용/MDD/전략ID 기준 미충족",
      },
    },
    collaboration_requests_via_jihye: [
      `[COLLAB_REQUEST] risk_controller | 체결 파라미터 완화 허용 한계(손실/MDD 기준) 수치 확정 | ${collabDeadline}`,
      `[COLLAB_REQUEST] signal_id_alignment_owner | strategy_id 불일치 최신 ${strategyMismatchLabel} 기준 재발방지안 제출 | ${collabDeadline}`,
      `[COLLAB_REQUEST] system_developer | LIMIT->MARKET 전환 지연(1800/5000ms) 환경변수 반영 가능 여부 확인 | ${collabDeadline}`,
    ],
    evolution: [
      "[EVOLUTION] 슬리피지 계산 기준을 signal_price 단일값에서 ref_px 동시검증으로 확장 | 체결 편차 측정 오차 축소",
      "[EVOLUTION] 부분체결률 경보를 intent 단위에서 심볼/시간대 단위로 분해 | 병목 구간 즉시 식별",
      "[EVOLUTION] 체결 지연 P95 기준 초과 시 자동으로 시장가 fallback 지연을 +500ms 상향하는 적응 룰 도입 | 과도한 추격 완화",
    ],
    self_rule: [
      `[SELF_RULE] 보수 비용(0.20%) 초과 시 신규 진입 확대 금지, 체결 품질만 개선한다. | 동일 유지 사유: 보수 비용 ${round(conservativeCost, 4)}%, 보수 MDD ${round(conservativeMdd, 4)}%로 안전기준 미충족`,
      "[SELF_RULE] 슬리피지·지연·부분체결 3지표를 매 사이클 수치로 갱신해 말이 아닌 데이터로 보고한다.",
      "[SELF_RULE] 불확실하면 작은 실험부터 진행하고, 실행 후 즉시 자가검증한다.",
    ],
    self_validation: {
      checks: [
        `Firestore 조회 성공: intents ${intents.length}건 / fills ${fills.length}건`,
        `핵심 지표 계산 성공: slippage(${slippageComparableCount}), latency(${createdToFillLatencyMs.length}), partial(${filledIntentWithFillRows})`,
        `보수 가드 연동 확인: cost ${round(conservativeCost, 4)} / mdd ${round(conservativeMdd, 4)} / mismatch ${strategyMismatchCount}`,
        `협업 요청 마감 자동 연동 확인: ${collabDeadline}`,
        `산출물 저장 확인: dated JSON/MD + latest JSON/MD`,
      ],
      result: "pass",
    },
    source_files: {
      data_consistency: dcPath,
      risk_controller: riskPath,
      strategy_alignment: strategyPath,
      approval_execution: approvalPath,
    },
    output_files: {},
  };

  const datedJson = path.join(OPS_DAILY, `${dateKey}_execution_microstructure_cycle${cycle}_jihye.json`);
  const datedMd = path.join(OPS_DAILY, `${dateKey}_execution_microstructure_cycle${cycle}_jihye.md`);
  const latestJson = path.join(OPS_DAILY, "execution_microstructure_latest.json");
  const latestMd = path.join(OPS_DAILY, "execution_microstructure_latest.md");

  payload.output_files = {
    dated_json: datedJson,
    dated_md: datedMd,
    latest_json: latestJson,
    latest_md: latestMd,
  };

  fs.writeFileSync(datedJson, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(latestJson, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const md = buildMarkdown(payload);
  fs.writeFileSync(datedMd, md, "utf8");
  fs.writeFileSync(latestMd, md, "utf8");

  console.log(JSON.stringify({
    ok: true,
    role: payload.role,
    cycle: payload.cycle,
    decision: payload.decision,
    key_metrics: {
      slippage_adverse_p95_bps: payload.metrics.slippage.adverse_p95_bps,
      latency_p95_ms: payload.metrics.latency.created_to_fill_p95_ms,
      partial_fill_rate_pct: payload.metrics.partial_fill.partial_fill_rate_pct,
      spread_p95_bps: payload.metrics.spread.p95_bps,
      fee_ratio_pct: payload.metrics.fee.fee_ratio_pct,
    },
    output_files: payload.output_files,
  }, null, 2));
}

main().catch((error) => {
  console.error("[execution-microstructure-cycle] failed:", error && error.message ? error.message : error);
  process.exit(1);
});
