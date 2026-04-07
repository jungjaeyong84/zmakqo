const express = require("express");
const router = express.Router();
const { getFirestore } = require("../storage/firestore");
const { resolveExchangeFromReq, resolveRuntimeTfContext } = require("../utils/resolveExchange");
const { isLiveDocForExchange } = require("../utils/liveOnly");
const { toKstString } = require("../utils/timeKst");
const { buildAiReasonKo, reasonSummaryKo } = require("../utils/aiReasonKo");
const { defaultExecTfFromEnv } = require("../utils/marketConfig");

function toMs(v) {
  const ms = Date.parse(String(v || ""));
  return Number.isFinite(ms) ? ms : 0;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function coalesce(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

function buildReasonDetail(x, feat, ai, kind) {
  const reason = x.reason || x.drop_reason_code || null;
  const code = x.drop_reason_code || null;
  if (kind !== "DROP") return reason || (ai && ai.ai_reason) || null;

  const parts = [];
  if (reason) parts.push(String(reason));
  if (code && code !== reason) parts.push(String(code));

  const lateBy = toNum(feat.late_by_bars) ?? toNum(feat._late_by_bars);
  const maxLate = toNum(feat.max_late_bars);
  if ((code === "DROP_STALE_SIGNAL" || reason === "DROP_STALE_SIGNAL") && lateBy != null) {
    parts.push(`late_by_bars=${lateBy}${maxLate != null ? `, max=${maxLate}` : ""}`);
  }

  if (code === "NO_POSITION_EXIT" || reason === "DROP_NO_POSITION_EXIT") {
    const posState = feat._pos_state_actual || feat.pos_state || null;
    const posDir = feat.pos_dir != null ? feat.pos_dir : null;
    const posSize = toNum(feat._pos_size_pct);
    const posActive = feat._pos_active === true;
    parts.push(
      [
        posState ? `pos_state=${posState}` : null,
        posDir != null ? `pos_dir=${posDir}` : null,
        posSize != null ? `pos_size_pct=${posSize}` : null,
        feat._pos_active != null ? `pos_active=${posActive}` : null,
      ].filter(Boolean).join(", ")
    );
  }

  if (code === "DROP_OVERLAP" || reason === "DROP_OVERLAP") {
    const overlapBars = toNum(feat.overlap_bars);
    const lastBar = toNum(feat.last_entry_bar_ms);
    parts.push(
      [
        overlapBars != null ? `overlap_bars=${overlapBars}` : null,
        lastBar != null ? `last_entry_bar_ms=${lastBar}` : null,
      ].filter(Boolean).join(", ")
    );
  }

  if (code === "DROP_LOW_SCORE" || reason === "DROP_LOW_SCORE") {
    const score = toNum(feat.score);
    const scoreMin = toNum(feat.score_min);
    parts.push(
      [
        score != null ? `score=${score.toFixed(2)}` : null,
        scoreMin != null ? `score_min=${scoreMin.toFixed(2)}` : null,
      ].filter(Boolean).join(", ")
    );
  }

  if (code === "DROP_SPIKE_LOCK" || reason === "DROP_SPIKE_LOCK") {
    const lockTf = feat.spike_lock_tf || null;
    const lockMove = toNum(feat.spike_lock_move_pct);
    const lockUntil = toNum(feat.spike_lock_until_ms);
    parts.push(
      [
        lockTf ? `lock_tf=${lockTf}` : null,
        lockMove != null ? `lock_move_pct=${lockMove.toFixed(4)}` : null,
        lockUntil != null ? `lock_until_ms=${lockUntil}` : null,
      ].filter(Boolean).join(", ")
    );
  }

  if ((code === "AI_BLOCK" || reason === "AI_BLOCK") && ai && ai.ai_reason) {
    const conf = toNum(ai.ai_confidence);
    parts.push(`ai_reason=${ai.ai_reason}${conf != null ? `, ai_conf=${conf.toFixed(2)}` : ""}`);
  } else if (ai && ai.ai_reason && ai.ai_reason !== reason) {
    parts.push(`ai_reason=${ai.ai_reason}`);
  }

  const detail = parts.filter((p) => p && String(p).trim()).join(" | ");
  return detail || reason || null;
}

async function fetchLatest(db, colName, limit) {
  try {
    const snap = await db.collection(colName).orderBy("created_at", "desc").limit(limit).get();
    const rows = [];
    snap.forEach((d) => rows.push({ id: d.id, ...(d.data() || {}) }));
    return rows;
  } catch (_) {
    return [];
  }
}

router.get("/dashboard/ai", async (req, res) => {
  try {
    const db = getFirestore();
    const { exchange, exCfg } = await resolveExchangeFromReq(req, 2000);
    const { signalTf } = await resolveRuntimeTfContext(req, exchange, {
      fallback: (exCfg && exCfg.exec_tf) || defaultExecTfFromEnv() || "15m",
      ttlMs: 2000,
    });

    const [signalsRaw, dropsRaw] = await Promise.all([
      fetchLatest(db, "signals", 200),
      fetchLatest(db, "signals_dropped", 200),
    ]);

    const mapRow = (x, kind) => {
      const ex = String(x.exchange || "").toUpperCase();
      if (ex && ex !== String(exchange || "").toUpperCase()) return null;
      if (!isLiveDocForExchange(exchange, x)) return null;
      if (String(x.tf || "") !== String(signalTf || "")) return null;
      const feat = x.features_json || x.features || {};
      const ai = feat.ai_signal || null;
      const cross = (ai && ai.ai_cross_asset && typeof ai.ai_cross_asset === "object") ? ai.ai_cross_asset : null;
      let crossScale = null;
      if (cross && Number.isFinite(Number(cross.sig_qty_pct)) && Number.isFinite(Number(cross.sig_qty_pct_final))) {
        const base = Number(cross.sig_qty_pct);
        const fin = Number(cross.sig_qty_pct_final);
        if (base > 0) crossScale = fin / base;
      }
      const reasonDetail = buildReasonDetail(x, feat, ai, kind);
      const aiReasonKo = ai && ai.ai_reason ? reasonSummaryKo(ai.ai_reason) : null;
      const aiNewsKo = ai && ai.ai_news_summary ? buildAiReasonKo(ai.ai_news_summary) : null;
      const crossReasonKo = cross && cross.reason ? reasonSummaryKo(cross.reason) : null;
      return {
        id: x.signal_id || x.drop_id || x.id || null,
        kind,
        created_at: x.created_at || null,
        created_kst: toKstString(x.created_at) || null,
        symbol_or_pair_id: x.symbol_or_pair_id || x.symbol || null,
        tf: x.tf || null,
        event: x.event || null,
        side: x.side || null,
        qty_pct: Number.isFinite(Number(x.qty_pct)) ? Number(x.qty_pct) : null,
        reason: x.reason || null,
        ai_decision: ai && ai.ai_decision ? String(ai.ai_decision) : null,
        ai_confidence: ai && Number.isFinite(Number(ai.ai_confidence)) ? Number(ai.ai_confidence) : null,
        ai_risk_mode: ai && ai.ai_risk_mode ? String(ai.ai_risk_mode) : null,
        ai_reason: ai && ai.ai_reason ? String(ai.ai_reason) : null,
        ai_reason_ko: aiReasonKo,
        ai_news_summary: ai && ai.ai_news_summary ? String(ai.ai_news_summary) : null,
        ai_news_summary_ko: aiNewsKo && aiNewsKo.summary_ko ? aiNewsKo.summary_ko : null,
        ai_qty_raw: ai && Number.isFinite(Number(ai.ai_qty_raw)) ? Number(ai.ai_qty_raw) : null,
        ai_qty_final: ai && Number.isFinite(Number(ai.ai_qty_final)) ? Number(ai.ai_qty_final) : null,
        ai_gpt_decision: ai && ai.ai_gpt_decision ? String(ai.ai_gpt_decision) : null,
        ai_gpt_confidence: ai && Number.isFinite(Number(ai.ai_gpt_confidence)) ? Number(ai.ai_gpt_confidence) : null,
        ai_claude_enabled: ai && typeof ai.ai_claude_enabled === "boolean" ? ai.ai_claude_enabled : null,
        ai_claude_attempted: ai && typeof ai.ai_claude_attempted === "boolean" ? ai.ai_claude_attempted : null,
        ai_claude_ok: ai && typeof ai.ai_claude_ok === "boolean" ? ai.ai_claude_ok : null,
        ai_claude_model: ai && ai.ai_claude_model ? String(ai.ai_claude_model) : null,
        ai_claude_decision: ai && ai.ai_claude_decision ? String(ai.ai_claude_decision) : null,
        ai_claude_confidence: ai && Number.isFinite(Number(ai.ai_claude_confidence)) ? Number(ai.ai_claude_confidence) : null,
        ai_ensemble_enabled: ai && typeof ai.ai_ensemble_enabled === "boolean" ? ai.ai_ensemble_enabled : null,
        ai_ensemble_score: ai && Number.isFinite(Number(ai.ai_ensemble_score)) ? Number(ai.ai_ensemble_score) : null,
        ai_ensemble_allow_min: ai && Number.isFinite(Number(ai.ai_ensemble_allow_min)) ? Number(ai.ai_ensemble_allow_min) : null,
        ai_ensemble_reduce_min: ai && Number.isFinite(Number(ai.ai_ensemble_reduce_min)) ? Number(ai.ai_ensemble_reduce_min) : null,
        ai_ensemble_w_gpt: ai && Number.isFinite(Number(ai.ai_ensemble_w_gpt)) ? Number(ai.ai_ensemble_w_gpt) : null,
        ai_ensemble_w_claude: ai && Number.isFinite(Number(ai.ai_ensemble_w_claude)) ? Number(ai.ai_ensemble_w_claude) : null,
        ai_cross_decision: cross && cross.decision ? String(cross.decision) : null,
        ai_cross_reason: cross && cross.reason ? String(cross.reason) : null,
        ai_cross_reason_ko: crossReasonKo,
        ai_cross_corr: cross && Number.isFinite(Number(cross.sig_corr)) ? Number(cross.sig_corr) : null,
        ai_cross_corr_n: cross && Number.isFinite(Number(cross.sig_corr_n)) ? Number(cross.sig_corr_n) : null,
        ai_cross_corr_source: cross && cross.sig_corr_source ? String(cross.sig_corr_source) : null,
        ai_cross_corr_tf: cross && cross.corr_tf ? String(cross.corr_tf) : null,
        ai_cross_corr_window: cross && Number.isFinite(Number(cross.corr_window)) ? Number(cross.corr_window) : null,
        ai_cross_positions_n: cross && Number.isFinite(Number(cross.positions_n)) ? Number(cross.positions_n) : null,
        ai_cross_beta: cross && Number.isFinite(Number(cross.sig_beta)) ? Number(cross.sig_beta) : null,
        ai_cross_level: cross && cross.corr_level ? String(cross.corr_level) : null,
        ai_cross_scale: Number.isFinite(crossScale) ? crossScale : null,
        ai_cross_net_before: cross && Number.isFinite(Number(cross.net_exposure)) ? Number(cross.net_exposure) : null,
        ai_cross_net_after: cross && Number.isFinite(Number(cross.net_exposure_after)) ? Number(cross.net_exposure_after) : null,
        reason_detail: reasonDetail,
      };
    };

    const signals = signalsRaw.map((x) => mapRow(x, "SIGNAL")).filter(Boolean);
    const drops = dropsRaw.map((x) => mapRow(x, "DROP")).filter(Boolean);

    const mergedBySignal = new Map();
    for (const row of [...signals, ...drops]) {
      const key = String(row.id || `${row.symbol_or_pair_id || "UNK"}__${row.tf || "UNK"}__${row.event || "UNK"}__${row.created_at || ""}`);
      const prev = mergedBySignal.get(key);
      if (!prev) {
        mergedBySignal.set(key, {
          ...row,
          signal_created_at: row.kind === "SIGNAL" ? row.created_at : null,
          signal_created_kst: row.kind === "SIGNAL" ? row.created_kst : null,
          signal_reason: row.kind === "SIGNAL" ? row.reason : null,
          signal_reason_detail: row.kind === "SIGNAL" ? row.reason_detail : null,
          drop_created_at: row.kind === "DROP" ? row.created_at : null,
          drop_created_kst: row.kind === "DROP" ? row.created_kst : null,
          drop_reason: row.kind === "DROP" ? row.reason : null,
          drop_reason_detail: row.kind === "DROP" ? row.reason_detail : null,
          has_signal: row.kind === "SIGNAL",
          has_drop: row.kind === "DROP",
          final_kind: row.kind,
          lifecycle: row.kind === "DROP" ? "SIGNAL→DROP" : "SIGNAL",
        });
        continue;
      }

      const signalRow = row.kind === "SIGNAL" ? row : prev.has_signal ? prev : null;
      const dropRow = row.kind === "DROP" ? row : prev.has_drop ? prev : null;
      const finalRow = dropRow || signalRow || row;
      mergedBySignal.set(key, {
        ...finalRow,
        id: key,
        symbol_or_pair_id: coalesce(signalRow && signalRow.symbol_or_pair_id, dropRow && dropRow.symbol_or_pair_id, prev.symbol_or_pair_id, row.symbol_or_pair_id),
        tf: coalesce(signalRow && signalRow.tf, dropRow && dropRow.tf, prev.tf, row.tf),
        side: coalesce(signalRow && signalRow.side, dropRow && dropRow.side, prev.side, row.side),
        event: coalesce(signalRow && signalRow.event, dropRow && dropRow.event, prev.event, row.event),
        qty_pct: coalesce(signalRow && signalRow.qty_pct, dropRow && dropRow.qty_pct, prev.qty_pct, row.qty_pct),
        ai_decision: coalesce(signalRow && signalRow.ai_decision, dropRow && dropRow.ai_decision, prev.ai_decision, row.ai_decision),
        ai_confidence: coalesce(signalRow && signalRow.ai_confidence, dropRow && dropRow.ai_confidence, prev.ai_confidence, row.ai_confidence),
        ai_risk_mode: coalesce(signalRow && signalRow.ai_risk_mode, dropRow && dropRow.ai_risk_mode, prev.ai_risk_mode, row.ai_risk_mode),
        ai_reason: coalesce(signalRow && signalRow.ai_reason, dropRow && dropRow.ai_reason, prev.ai_reason, row.ai_reason),
        ai_news_summary: coalesce(signalRow && signalRow.ai_news_summary, dropRow && dropRow.ai_news_summary, prev.ai_news_summary, row.ai_news_summary),
        ai_qty_raw: coalesce(signalRow && signalRow.ai_qty_raw, dropRow && dropRow.ai_qty_raw, prev.ai_qty_raw, row.ai_qty_raw),
        ai_qty_final: coalesce(signalRow && signalRow.ai_qty_final, dropRow && dropRow.ai_qty_final, prev.ai_qty_final, row.ai_qty_final),
        ai_gpt_decision: coalesce(signalRow && signalRow.ai_gpt_decision, dropRow && dropRow.ai_gpt_decision, prev.ai_gpt_decision, row.ai_gpt_decision),
        ai_gpt_confidence: coalesce(signalRow && signalRow.ai_gpt_confidence, dropRow && dropRow.ai_gpt_confidence, prev.ai_gpt_confidence, row.ai_gpt_confidence),
        ai_claude_enabled: coalesce(signalRow && signalRow.ai_claude_enabled, dropRow && dropRow.ai_claude_enabled, prev.ai_claude_enabled, row.ai_claude_enabled),
        ai_claude_attempted: coalesce(signalRow && signalRow.ai_claude_attempted, dropRow && dropRow.ai_claude_attempted, prev.ai_claude_attempted, row.ai_claude_attempted),
        ai_claude_ok: coalesce(signalRow && signalRow.ai_claude_ok, dropRow && dropRow.ai_claude_ok, prev.ai_claude_ok, row.ai_claude_ok),
        ai_claude_model: coalesce(signalRow && signalRow.ai_claude_model, dropRow && dropRow.ai_claude_model, prev.ai_claude_model, row.ai_claude_model),
        ai_claude_decision: coalesce(signalRow && signalRow.ai_claude_decision, dropRow && dropRow.ai_claude_decision, prev.ai_claude_decision, row.ai_claude_decision),
        ai_claude_confidence: coalesce(signalRow && signalRow.ai_claude_confidence, dropRow && dropRow.ai_claude_confidence, prev.ai_claude_confidence, row.ai_claude_confidence),
        ai_ensemble_enabled: coalesce(signalRow && signalRow.ai_ensemble_enabled, dropRow && dropRow.ai_ensemble_enabled, prev.ai_ensemble_enabled, row.ai_ensemble_enabled),
        ai_ensemble_score: coalesce(signalRow && signalRow.ai_ensemble_score, dropRow && dropRow.ai_ensemble_score, prev.ai_ensemble_score, row.ai_ensemble_score),
        ai_ensemble_allow_min: coalesce(signalRow && signalRow.ai_ensemble_allow_min, dropRow && dropRow.ai_ensemble_allow_min, prev.ai_ensemble_allow_min, row.ai_ensemble_allow_min),
        ai_ensemble_reduce_min: coalesce(signalRow && signalRow.ai_ensemble_reduce_min, dropRow && dropRow.ai_ensemble_reduce_min, prev.ai_ensemble_reduce_min, row.ai_ensemble_reduce_min),
        ai_ensemble_w_gpt: coalesce(signalRow && signalRow.ai_ensemble_w_gpt, dropRow && dropRow.ai_ensemble_w_gpt, prev.ai_ensemble_w_gpt, row.ai_ensemble_w_gpt),
        ai_ensemble_w_claude: coalesce(signalRow && signalRow.ai_ensemble_w_claude, dropRow && dropRow.ai_ensemble_w_claude, prev.ai_ensemble_w_claude, row.ai_ensemble_w_claude),
        ai_cross_decision: coalesce(signalRow && signalRow.ai_cross_decision, dropRow && dropRow.ai_cross_decision, prev.ai_cross_decision, row.ai_cross_decision),
        ai_cross_reason: coalesce(signalRow && signalRow.ai_cross_reason, dropRow && dropRow.ai_cross_reason, prev.ai_cross_reason, row.ai_cross_reason),
        ai_cross_corr: coalesce(signalRow && signalRow.ai_cross_corr, dropRow && dropRow.ai_cross_corr, prev.ai_cross_corr, row.ai_cross_corr),
        ai_cross_corr_n: coalesce(signalRow && signalRow.ai_cross_corr_n, dropRow && dropRow.ai_cross_corr_n, prev.ai_cross_corr_n, row.ai_cross_corr_n),
        ai_cross_corr_source: coalesce(signalRow && signalRow.ai_cross_corr_source, dropRow && dropRow.ai_cross_corr_source, prev.ai_cross_corr_source, row.ai_cross_corr_source),
        ai_cross_corr_tf: coalesce(signalRow && signalRow.ai_cross_corr_tf, dropRow && dropRow.ai_cross_corr_tf, prev.ai_cross_corr_tf, row.ai_cross_corr_tf),
        ai_cross_corr_window: coalesce(signalRow && signalRow.ai_cross_corr_window, dropRow && dropRow.ai_cross_corr_window, prev.ai_cross_corr_window, row.ai_cross_corr_window),
        ai_cross_positions_n: coalesce(signalRow && signalRow.ai_cross_positions_n, dropRow && dropRow.ai_cross_positions_n, prev.ai_cross_positions_n, row.ai_cross_positions_n),
        ai_cross_beta: coalesce(signalRow && signalRow.ai_cross_beta, dropRow && dropRow.ai_cross_beta, prev.ai_cross_beta, row.ai_cross_beta),
        ai_cross_level: coalesce(signalRow && signalRow.ai_cross_level, dropRow && dropRow.ai_cross_level, prev.ai_cross_level, row.ai_cross_level),
        ai_cross_scale: coalesce(signalRow && signalRow.ai_cross_scale, dropRow && dropRow.ai_cross_scale, prev.ai_cross_scale, row.ai_cross_scale),
        ai_cross_net_before: coalesce(signalRow && signalRow.ai_cross_net_before, dropRow && dropRow.ai_cross_net_before, prev.ai_cross_net_before, row.ai_cross_net_before),
        ai_cross_net_after: coalesce(signalRow && signalRow.ai_cross_net_after, dropRow && dropRow.ai_cross_net_after, prev.ai_cross_net_after, row.ai_cross_net_after),
        created_at: coalesce(dropRow && dropRow.created_at, signalRow && signalRow.created_at, prev.created_at, row.created_at),
        created_kst: coalesce(dropRow && dropRow.created_kst, signalRow && signalRow.created_kst, prev.created_kst, row.created_kst),
        reason: coalesce(dropRow && dropRow.reason, signalRow && signalRow.reason, prev.reason, row.reason),
        reason_detail: coalesce(dropRow && dropRow.reason_detail, signalRow && signalRow.reason_detail, prev.reason_detail, row.reason_detail),
        signal_created_at: coalesce(prev.signal_created_at, signalRow && signalRow.created_at),
        signal_created_kst: coalesce(prev.signal_created_kst, signalRow && signalRow.created_kst),
        signal_reason: coalesce(prev.signal_reason, signalRow && signalRow.reason),
        signal_reason_detail: coalesce(prev.signal_reason_detail, signalRow && signalRow.reason_detail),
        drop_created_at: coalesce(prev.drop_created_at, dropRow && dropRow.created_at),
        drop_created_kst: coalesce(prev.drop_created_kst, dropRow && dropRow.created_kst),
        drop_reason: coalesce(prev.drop_reason, dropRow && dropRow.reason),
        drop_reason_detail: coalesce(prev.drop_reason_detail, dropRow && dropRow.reason_detail),
        has_signal: prev.has_signal || row.kind === "SIGNAL",
        has_drop: prev.has_drop || row.kind === "DROP",
        final_kind: dropRow ? "DROP" : "SIGNAL",
        lifecycle: (prev.has_signal || row.kind === "SIGNAL") && (prev.has_drop || row.kind === "DROP") ? "SIGNAL→DROP" : (dropRow ? "DROP" : "SIGNAL"),
      });
    }

    const merged = Array.from(mergedBySignal.values())
      .sort((a, b) => toMs(b.created_at) - toMs(a.created_at))
      .slice(0, 200);
    const lastCreatedAt = merged.length ? merged[0].created_at : null;

    return res.render("trading.ai.ejs", {
      rows: merged,
      exchange,
      signal_tf: signalTf,
      meta: {
        n: merged.length,
        last_created_at: lastCreatedAt,
        last_created_kst: toKstString(lastCreatedAt),
      },
    });
  } catch (e) {
    try {
      return res.status(200).render("trading.ai.ejs", {
        rows: [],
        exchange: req.query.exchange || '',
        signal_tf: null,
        meta: { n: 0, last_created_at: null, last_created_kst: null },
        _error: { code: "AI_JOURNAL_ROUTE_ERROR", message: '데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' },
      });
    } catch (renderErr) {
      return res.status(500).send("RENDER_FALLBACK_ERROR: " + (renderErr.message || String(renderErr)));
    }
  }
});

module.exports = router;
