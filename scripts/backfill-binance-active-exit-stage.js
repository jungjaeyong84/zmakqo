#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");
const { listExchangePositionReadViews } = require("../src/services/positionReadModel");
const { resolveExitRulesForPosition } = require("../src/engine/signalEngine");
const { resolveExitStageAbsoluteContractQtyRatio, resolveTp1RemainingContractQtyRatio } = require("../src/utils/exitQtyContract");
const { reclassifyExternalFillEvent } = require("../src/storage/fillsPaper");
const { getPosition, upsertPositionMetaOnly } = require("../src/storage/positionsPaper");
const {
  syncFuturesPositionOnly,
  resolveFuturesPositionSyncRequest,
  __test: paperRunnerTest,
} = require("../src/engine/paperBinanceRunner");
const { __test: fillProjectionAuditTest } = require("../src/services/binanceFillProjectionAudit");

const EXCHANGE = "BINANCEFUT";
const LOOKBACK_DAYS = Math.max(3, Number(process.env.BINANCE_ACTIVE_EXIT_STAGE_LOOKBACK_DAYS || 14));
const PAGE_SIZE = Math.max(100, Number(process.env.BINANCE_ACTIVE_EXIT_STAGE_PAGE_SIZE || 1000));
const QTY_TOL_RATIO = Math.max(0.01, Number(process.env.BINANCE_ACTIVE_EXIT_STAGE_QTY_TOL_RATIO || 0.03));
const argv = process.argv.slice(2);
const argvDryRun = argv.includes("--dry-run") || argv.includes("--dryrun");
const DRY_RUN = argvDryRun || ["1", "true", "yes", "y", "on"].includes(String(process.env.DRY_RUN || "").trim().toLowerCase());

function isoDate(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseMs(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function isActivePosition(pos = {}) {
  const state = upper(pos.state || pos.position_state);
  const qtyBase = toNum(pos.qty_base);
  const sizePct = toNum(pos.size_pct);
  return (((Number.isFinite(qtyBase) && qtyBase > 0) || (Number.isFinite(sizePct) && sizePct > 0)) && state !== "FLAT");
}

function isSimplifiedExitV2Position(position = {}) {
  const meta = position && typeof position.meta === "object" ? position.meta : {};
  return meta.simplified_exit_v2_enabled === true
    || meta.simplifiedExitV2Enabled === true
    || position.simplified_exit_v2_enabled === true;
}

function classifyExitEvent(event) {
  const ev = upper(event);
  if (!ev) return "OTHER";
  if (ev.startsWith("EXIT_TP_P0")) return "TP0";
  if (ev.startsWith("EXIT_TP_P1")) return "TP1";
  if (ev.startsWith("EXIT_TRAIL")) return "TRAIL";
  if (ev.startsWith("EXIT_SL")) return "SL";
  if (ev === "FORCE_EXIT_ALL" || ev === "EXIT_ALL" || ev === "EXIT_FORCE_ALL") return "FORCE_EXIT_ALL";
  if (ev === "FORCE_EXIT_HALF") return "FORCE_EXIT_HALF";
  if (ev.startsWith("EXIT_")) return "OTHER_EXIT";
  return "OTHER";
}

function isExternalFill(fill = {}) {
  const fillId = String(fill.id || fill.fill_id || "").trim().toUpperCase();
  return fillId.startsWith("EXT__");
}

function buildAuthoritativeFillSet(rows = []) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const orderId = String(row.external_order_id || row.live_order_id || row.order_id || "NO_ORDER").trim();
    const key = orderId !== "NO_ORDER"
      ? `${classifyExitEvent(row.event)}__${orderId}`
      : [
          classifyExitEvent(row.event),
          orderId,
          Number.isFinite(Number(row.exec_price)) ? Number(row.exec_price).toFixed(8) : "NO_PRICE",
          String(row.created_at || "").slice(0, 19),
        ].join("__");
    const bucket = groups.get(key) || [];
    bucket.push(row);
    groups.set(key, bucket);
  }
  const out = [];
  for (const bucket of groups.values()) {
    const hasExternal = bucket.some((row) => isExternalFill(row));
    if (hasExternal) out.push(...bucket.filter((row) => isExternalFill(row)));
    else out.push(...bucket);
  }
  return out.sort((a, b) => {
    return (parseMs(a.created_at) || 0) - (parseMs(b.created_at) || 0)
      || String(a.id || a.fill_id || "").localeCompare(String(b.id || b.fill_id || ""));
  });
}

async function fetchRecentExitFills(db) {
  const out = [];
  const sinceIso = new Date(Date.now() - (LOOKBACK_DAYS * 24 * 60 * 60 * 1000)).toISOString();
  let last = null;
  for (;;) {
    let q = db.collection("fills_paper").orderBy("created_at", "desc").limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const fill = doc.data() || {};
      if (upper(fill.exchange) !== EXCHANGE) continue;
      if (String(fill.created_at || "") < sinceIso) continue;
      if (classifyExitEvent(fill.event) === "OTHER") continue;
      out.push({ id: doc.id, ...fill });
    }
    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return out;
}

function filterCurrentEntryFills(position, fills = []) {
  const meta = (position && typeof position.meta === "object") ? position.meta : {};
  return (Array.isArray(fills) ? fills : []).filter((fill) => fillProjectionAuditTest.fillMatchesCurrentEntry(fill, meta));
}

function buildStageSummary(position, fills = []) {
  const pos = position || {};
  const meta = (pos && typeof pos.meta === "object") ? pos.meta : {};
  const simplifiedExitV2Enabled = isSimplifiedExitV2Position(pos);
  const rules = resolveExitRulesForPosition({
    exchange: EXCHANGE,
    position: pos,
  });
  const tp0AbsRatio = simplifiedExitV2Enabled ? 0 : resolveExitStageAbsoluteContractQtyRatio("TP0", rules);
  const tp1AbsRatio = simplifiedExitV2Enabled
    ? resolveTp1RemainingContractQtyRatio(rules, 0.5)
    : resolveExitStageAbsoluteContractQtyRatio("TP1", rules);
  const currentQtyBase = Math.max(0, toNum(pos.qty_base) || 0);
  const authoritativeFills = buildAuthoritativeFillSet(filterCurrentEntryFills(pos, fills));
  let tp0QtyBase = 0;
  let tp1QtyBase = 0;
  let trailQtyBase = 0;
  let totalExitQtyBase = 0;
  for (const fill of authoritativeFills) {
    const stage = classifyExitEvent(fill.event);
    const qtyBase = Math.max(0, toNum(fill.exec_qty_base) || 0);
    if (!(qtyBase > 0)) continue;
    totalExitQtyBase += qtyBase;
    if (stage === "TP0") tp0QtyBase += qtyBase;
    else if (stage === "TP1") tp1QtyBase += qtyBase;
    else if (stage === "TRAIL") trailQtyBase += qtyBase;
  }
  const inferredEntryQtyBase = currentQtyBase + totalExitQtyBase;
  const tolQtyBase = inferredEntryQtyBase > 0 ? inferredEntryQtyBase * QTY_TOL_RATIO : 0;
  const expectedTp0QtyBase = inferredEntryQtyBase * (tp0AbsRatio || 0);
  const expectedTp1QtyBase = inferredEntryQtyBase * (tp1AbsRatio || 0);
  const shouldTp0 = simplifiedExitV2Enabled !== true
    && inferredEntryQtyBase > 0
    && totalExitQtyBase >= Math.max(0, expectedTp0QtyBase - tolQtyBase);
  const shouldTp1 = inferredEntryQtyBase > 0 && totalExitQtyBase >= Math.max(0, expectedTp0QtyBase + expectedTp1QtyBase - tolQtyBase);
  const shouldTrail = simplifiedExitV2Enabled !== true && shouldTp1 && currentQtyBase > tolQtyBase;
  const latestExitFill = authoritativeFills[authoritativeFills.length - 1] || null;
  const latestStage = classifyExitEvent(latestExitFill && latestExitFill.event);
  const latestExitOrderId = latestExitFill
    ? String(latestExitFill.external_order_id || latestExitFill.live_order_id || latestExitFill.order_id || "").trim() || null
    : null;
  const issues = [];
  if (shouldTp0 && meta.tp_p0_done !== true) issues.push("TP0_DONE_MISSING_BY_QTY");
  if (shouldTp1 && meta.tp_p1_done !== true) issues.push("TP1_DONE_MISSING_BY_QTY");
  if (shouldTrail && meta.trail_active !== true) issues.push("TRAIL_ACTIVE_MISSING_BY_QTY");
  if (simplifiedExitV2Enabled !== true && meta.tp_p1_done === true && meta.tp_p0_done !== true) issues.push("TP1_DONE_WITHOUT_TP0_DONE");
  if (simplifiedExitV2Enabled !== true && meta.trail_active === true && meta.tp_p0_done !== true) issues.push("TRAIL_ACTIVE_WITHOUT_TP0_DONE");
  if (latestStage === "TP0" && shouldTp1) issues.push("LATEST_TP0_SHOULD_BE_TP1");
  return {
    symbol: upper(pos.symbol || pos.symbol_or_pair_id),
    simplified_exit_v2_enabled: simplifiedExitV2Enabled,
    state: upper(pos.state || pos.position_state),
    current_qty_base: currentQtyBase,
    inferred_entry_qty_base: inferredEntryQtyBase,
    total_exit_qty_base: totalExitQtyBase,
    tp0_qty_base: tp0QtyBase,
    tp1_qty_base: tp1QtyBase,
    trail_qty_base: trailQtyBase,
    expected_tp0_qty_base: expectedTp0QtyBase,
    expected_tp1_qty_base: expectedTp1QtyBase,
    tp0_abs_ratio: tp0AbsRatio,
    tp1_abs_ratio: tp1AbsRatio,
    should_tp0_done: shouldTp0,
    should_tp1_done: shouldTp1,
    should_trail_active: shouldTrail,
    actual_tp0_done: meta.tp_p0_done === true,
    actual_tp1_done: meta.tp_p1_done === true,
    actual_trail_active: meta.trail_active === true,
    latest_exit_fill_id: latestExitFill ? String(latestExitFill.id || latestExitFill.fill_id || "") : null,
    latest_exit_order_id: latestExitOrderId,
    latest_exit_event: latestExitFill ? upper(latestExitFill.event) : null,
    latest_exit_created_at: latestExitFill ? (latestExitFill.created_at || null) : null,
    latest_exit_qty_base: latestExitFill ? (toNum(latestExitFill.exec_qty_base) || null) : null,
    authoritative_fills: authoritativeFills.map((fill) => ({
      fill_id: String(fill.id || fill.fill_id || "").trim() || null,
      event: upper(fill.event),
      order_id: String(fill.external_order_id || fill.live_order_id || fill.order_id || "").trim() || null,
      created_at: fill.created_at || null,
      exec_qty_base: toNum(fill.exec_qty_base),
    })),
    issues,
  };
}

function buildTp0ToTp1ReclassificationTargets(summary = {}) {
  const fills = Array.isArray(summary.authoritative_fills) ? summary.authoritative_fills : [];
  const latestOrderId = String(summary.latest_exit_order_id || "").trim();
  if (!latestOrderId) return [];
  return fills
    .filter((fill) => String(fill.order_id || "").trim() === latestOrderId)
    .filter((fill) => classifyExitEvent(fill.event) === "TP0")
    .map((fill) => String(fill.fill_id || "").trim())
    .filter(Boolean);
}

function buildTp1ToTp0ReclassificationTargets(summary = {}) {
  const fills = Array.isArray(summary.authoritative_fills) ? summary.authoritative_fills : [];
  const expectedTp0Qty = Math.max(0, toNum(summary.expected_tp0_qty_base) || 0);
  const tp0Qty = Math.max(0, toNum(summary.tp0_qty_base) || 0);
  const tolQty = Math.max(0.00000001, toNum(summary.inferred_entry_qty_base) || 0) * QTY_TOL_RATIO;
  const missingTp0Qty = Math.max(0, expectedTp0Qty - tp0Qty);
  if (!(missingTp0Qty > 0)) return [];
  return fills
    .filter((fill) => classifyExitEvent(fill.event) === "TP1")
    .filter((fill) => {
      const qty = Math.max(0, toNum(fill.exec_qty_base) || 0);
      return Math.abs(qty - missingTp0Qty) <= Math.max(tolQty, missingTp0Qty * 0.4, 0.00000001);
    })
    .sort((a, b) => (parseMs(a.created_at) || 0) - (parseMs(b.created_at) || 0))
    .map((fill) => String(fill.fill_id || "").trim())
    .filter(Boolean);
}

function buildStageReclassificationPlan(summary = {}) {
  const plan = [];
  if (Array.isArray(summary.issues) && summary.issues.includes("LATEST_TP0_SHOULD_BE_TP1")) {
    for (const fillId of buildTp0ToTp1ReclassificationTargets(summary)) {
      const targetTp1Event = summary.simplified_exit_v2_enabled === true
        ? "EXIT_TP_P1_1.68P"
        : "EXIT_TP_P1_1.65P";
      plan.push({
        fill_id: fillId,
        from_event_stage: "TP0",
        to_event: targetTp1Event,
        decision_reason: "ACTIVE_EXIT_STAGE_BACKFILL_RECLASSIFIED",
        reclassify_reason: "CURRENT_QTY_FLOW_IMPLIES_TP1",
      });
    }
  }
  if (Array.isArray(summary.issues) && summary.issues.includes("TP1_DONE_WITHOUT_TP0_DONE")) {
    for (const fillId of buildTp1ToTp0ReclassificationTargets(summary)) {
      plan.push({
        fill_id: fillId,
        from_event_stage: "TP1",
        to_event: "EXIT_TP_P0_0.8P",
        decision_reason: "ACTIVE_EXIT_STAGE_BACKFILL_RECLASSIFIED",
        reclassify_reason: "TP1_LABEL_WITH_TP0_SIZE_MUST_BE_TP0",
      });
    }
  }
  return plan;
}

function applyReclassificationPlanToFills(fills = [], plan = []) {
  const byId = new Map((Array.isArray(plan) ? plan : []).map((row) => [String(row.fill_id || "").trim(), row]));
  return (Array.isArray(fills) ? fills : []).map((fill) => {
    const planRow = byId.get(String(fill && (fill.id || fill.fill_id) || "").trim());
    if (!planRow) return fill;
    return {
      ...fill,
      event: planRow.to_event,
    };
  });
}

function buildReconciledMetaFromSummary(position = {}, summary = {}) {
  const pos = position || {};
  const currentMeta = (pos && typeof pos.meta === "object") ? pos.meta : {};
  const simplifiedExitV2Enabled = isSimplifiedExitV2Position(pos) || summary.simplified_exit_v2_enabled === true;
  const authoritativeFills = Array.isArray(summary.authoritative_fills) ? summary.authoritative_fills : [];
  let nextMeta = { ...currentMeta };
  const latestTp0Fill = paperRunnerTest.pickLatestTpP0Fill(authoritativeFills, EXCHANGE, summary.symbol);
  const latestTp1Fill = paperRunnerTest.pickLatestTpP1Fill(authoritativeFills, EXCHANGE, summary.symbol);
  if (latestTp0Fill) {
    nextMeta = paperRunnerTest.reconcileTpP0MetaFromFill({
      posMeta: nextMeta,
      pos,
      fill: latestTp0Fill,
    });
  }
  if (latestTp1Fill) {
    nextMeta = paperRunnerTest.reconcileTpP1MetaFromFill({
      posMeta: nextMeta,
      pos,
      fill: latestTp1Fill,
    });
  }
  if (summary.should_tp0_done) nextMeta.tp_p0_done = true;
  if (summary.should_tp1_done) nextMeta.tp_p1_done = true;
  if (summary.should_trail_active) nextMeta.trail_active = true;
  if (nextMeta.trail_active === true) nextMeta.tp_p1_done = true;
  if (simplifiedExitV2Enabled === true) nextMeta.tp_p0_done = false;
  else if (nextMeta.tp_p1_done === true) nextMeta.tp_p0_done = true;
  const currentQtyBase = Math.max(0, toNum(summary.current_qty_base) || 0);
  const canonicalStage = nextMeta.trail_active === true
    ? "TRAIL"
    : (nextMeta.tp_p1_done === true ? "TP1" : (simplifiedExitV2Enabled === true ? null : (nextMeta.tp_p0_done === true ? "TP0" : null)));
  nextMeta.canonical_exit_stage = canonicalStage;
  nextMeta.canonical_runner_remaining_abs = (nextMeta.tp_p1_done === true || nextMeta.trail_active === true) && currentQtyBase > 0
    ? currentQtyBase
    : null;
  return nextMeta;
}

async function main() {
  const db = getFirestore();
  const allPositions = await listExchangePositionReadViews({ exchange: EXCHANGE, limit: 500 }).catch(() => []);
  const activePositions = allPositions.filter((row) => isActivePosition(row));
  const activeSymbols = new Set(activePositions.map((row) => upper(row.symbol || row.symbol_or_pair_id)).filter(Boolean));
  const recentFillsAll = await fetchRecentExitFills(db);
  const fillsBySymbol = new Map();
  for (const fill of recentFillsAll) {
    const symbol = upper(fill.symbol || fill.symbol_or_pair_id);
    if (!symbol || !activeSymbols.has(symbol)) continue;
    const bucket = fillsBySymbol.get(symbol) || [];
    bucket.push(fill);
    fillsBySymbol.set(symbol, bucket);
  }

  const reportRows = [];
  const actions = [];
  for (const pos of activePositions) {
    const symbol = upper(pos.symbol || pos.symbol_or_pair_id);
    const summary = buildStageSummary(pos, fillsBySymbol.get(symbol) || []);
    reportRows.push(summary);

    const action = {
      symbol,
      issues: summary.issues.slice(),
      latest_exit_fill_id: summary.latest_exit_fill_id,
      latest_exit_order_id: summary.latest_exit_order_id,
      latest_exit_event: summary.latest_exit_event,
      reclassified_fill_ids: [],
      meta_repaired: false,
      sync_run_id: null,
      status: "NOOP",
    };

    try {
      const reclassificationPlan = buildStageReclassificationPlan(summary);
      if (reclassificationPlan.length) {
        if (!DRY_RUN) {
          for (const step of reclassificationPlan) {
            await reclassifyExternalFillEvent({
              fillId: step.fill_id,
              event: step.to_event,
              decisionReason: step.decision_reason,
              reclassifyReason: step.reclassify_reason,
              reclassifyScript: "scripts/backfill-binance-active-exit-stage.js",
            });
          }
        }
        action.reclassified_fill_ids = reclassificationPlan.map((row) => row.fill_id);
      }

      const nextSummary = reclassificationPlan.length
        ? buildStageSummary(pos, applyReclassificationPlanToFills(fillsBySymbol.get(symbol) || [], reclassificationPlan))
        : summary;
      const currentPosition = DRY_RUN ? pos : await getPosition({ exchange: EXCHANGE, symbol });
      const currentMeta = (currentPosition && typeof currentPosition.meta === "object") ? currentPosition.meta : {};
      const nextMeta = buildReconciledMetaFromSummary(currentPosition || pos, nextSummary);
      const metaChanged = JSON.stringify(currentMeta || {}) !== JSON.stringify(nextMeta || {});
      if (metaChanged || reclassificationPlan.length) {
        if (!DRY_RUN) {
          await upsertPositionMetaOnly({
            exchange: EXCHANGE,
            symbol,
            runId: `RUN__ACTIVE_EXIT_STAGE_META_REPAIR__${symbol}__${Date.now()}`,
            executionMode: currentPosition && currentPosition.execution_mode ? currentPosition.execution_mode : null,
            meta: nextMeta,
            source: "ACTIVE_EXIT_STAGE_BACKFILL",
            mutationKind: "POSITION_META_EXIT_STAGE_BACKFILL",
            reason: "ACTIVE_EXIT_STAGE_SUMMARY_RECONCILED",
            expectedWriteToken: Object.prototype.hasOwnProperty.call(currentPosition || {}, "position_write_token")
              ? (currentPosition.position_write_token ?? null)
              : null,
          });
        }
        action.meta_repaired = true;
      }

      if (!DRY_RUN && (metaChanged || reclassificationPlan.length)) {
        action.sync_run_id = `RUN__ACTIVE_EXIT_STAGE_BACKFILL__${symbol}__${Date.now()}`;
        await syncFuturesPositionOnly(resolveFuturesPositionSyncRequest({
          source: "ACTIVE_EXIT_STAGE_BACKFILL",
          runId: action.sync_run_id,
          exchange: EXCHANGE,
          symbol,
          force: true,
        }));
      }
      action.status = (metaChanged || reclassificationPlan.length)
        ? (DRY_RUN ? "DRY_RUN" : "APPLIED")
        : "NOOP";
    } catch (err) {
      action.status = "FAILED";
      action.error = err && err.message ? err.message : String(err);
    }
    if (action.status !== "NOOP" || action.issues.length) actions.push(action);
  }

  const latestViews = DRY_RUN
    ? {}
    : await listExchangePositionReadViews({ exchange: EXCHANGE, limit: 500 }).then((rows) => {
        return (rows || []).reduce((acc, row) => {
          const symbol = upper(row.symbol || row.symbol_or_pair_id);
          if (!symbol) return acc;
          acc[symbol] = row;
          return acc;
        }, {});
      }).catch(() => ({}));

  const report = {
    ok: true,
    dry_run: DRY_RUN,
    exchange: EXCHANGE,
    generated_at: nowIso(),
    active_position_n: activePositions.length,
    scanned_fill_n: recentFillsAll.length,
    issue_symbol_n: reportRows.filter((row) => Array.isArray(row.issues) && row.issues.length).length,
    issue_rows: reportRows.filter((row) => Array.isArray(row.issues) && row.issues.length),
    actions,
    post_apply_summary: DRY_RUN ? null : actions.map((action) => {
      const next = latestViews[action.symbol] || null;
      const meta = next && next.meta && typeof next.meta === "object" ? next.meta : {};
      return {
        symbol: action.symbol,
        status: action.status,
        tp_p0_done: meta.tp_p0_done === true,
        tp_p1_done: meta.tp_p1_done === true,
        trail_active: meta.trail_active === true,
        canonical_exit_stage: meta.canonical_exit_stage || null,
        canonical_runner_remaining_abs: toNum(meta.canonical_runner_remaining_abs),
        qty_base: toNum(next && next.qty_base),
        updated_at: next && next.updated_at ? next.updated_at : null,
      };
    }),
  };

  const outDir = path.join(process.cwd(), "ops", "daily");
  fs.mkdirSync(outDir, { recursive: true });
  const latestJson = path.join(outDir, "binance_active_exit_stage_backfill_latest.json");
  const datedJson = path.join(outDir, `${isoDate()}_binance_active_exit_stage_backfill.json`);
  fs.writeFileSync(latestJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(datedJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    ok: true,
    dry_run: DRY_RUN,
    active_position_n: report.active_position_n,
    issue_symbol_n: report.issue_symbol_n,
    applied_n: actions.filter((row) => row.status === "APPLIED").length,
    failed_n: actions.filter((row) => row.status === "FAILED").length,
    output_json: latestJson,
    sample_issues: report.issue_rows.slice(0, 10).map((row) => ({
      symbol: row.symbol,
      issues: row.issues,
      latest_exit_event: row.latest_exit_event,
      latest_exit_fill_id: row.latest_exit_fill_id,
      latest_exit_order_id: row.latest_exit_order_id,
      reclassification_targets: buildStageReclassificationPlan(row),
    })),
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("BACKFILL_BINANCE_ACTIVE_EXIT_STAGE_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
} else {
  module.exports = {
    __test: {
      buildStageSummary,
      buildStageReclassificationTargets: buildStageReclassificationPlan,
      buildTp0ToTp1ReclassificationTargets,
      buildTp1ToTp0ReclassificationTargets,
      buildStageReclassificationPlan,
      buildReconciledMetaFromSummary,
      applyReclassificationPlanToFills,
      buildAuthoritativeFillSet,
      filterCurrentEntryFills,
      classifyExitEvent,
    },
  };
}
