"use strict";

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function clamp01(v) {
  return clamp(v, 0, 1);
}

function normalizeBar(raw) {
  if (!raw || typeof raw !== "object") return null;
  const open = toNum(raw.open ?? raw.o);
  const high = toNum(raw.high ?? raw.h);
  const low = toNum(raw.low ?? raw.l);
  const close = toNum(raw.close ?? raw.c);
  const volume = toNum(raw.volume ?? raw.v);
  const timestamp = toNum(raw.closeTimeUtcMs ?? raw.bar_close_time_utc_ms ?? raw.timestamp ?? raw.t);
  if (
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close) ||
    !Number.isFinite(timestamp)
  ) {
    return null;
  }
  return { open, high, low, close, volume, timestamp };
}

function directionalMovePct(fromClose, toClose, dir) {
  const from = toNum(fromClose);
  const to = toNum(toClose);
  if (!Number.isFinite(from) || from <= 0 || !Number.isFinite(to) || to <= 0) return null;
  if (String(dir || "").toUpperCase() === "SHORT") {
    return ((from - to) / from) * 100;
  }
  return ((to - from) / from) * 100;
}

function trueRangePct(curr, prevClose) {
  if (!curr || !Number.isFinite(curr.high) || !Number.isFinite(curr.low)) return null;
  const prev = toNum(prevClose);
  const ref = Number.isFinite(prev) && prev > 0 ? prev : curr.close;
  if (!Number.isFinite(ref) || ref <= 0) return null;
  const tr = Math.max(
    curr.high - curr.low,
    Math.abs(curr.high - ref),
    Math.abs(curr.low - ref)
  );
  return (tr / ref) * 100;
}

function computeDirectionalStreak(bars, dir) {
  let sameDirStreak = 0;
  let counterDirBars = 0;
  for (let i = bars.length - 1; i >= 1; i -= 1) {
    const prev = bars[i - 1];
    const curr = bars[i];
    const move = directionalMovePct(prev.close, curr.close, dir);
    if (!Number.isFinite(move)) break;
    if (move > 0) sameDirStreak += 1;
    else break;
  }
  const recent = bars.slice(-4);
  for (let i = 1; i < recent.length; i += 1) {
    const move = directionalMovePct(recent[i - 1].close, recent[i].close, dir);
    if (Number.isFinite(move) && move <= 0) counterDirBars += 1;
  }
  return { sameDirStreak, counterDirBars };
}

function closeControlRatio(bar, dir) {
  if (!bar) return null;
  const range = bar.high - bar.low;
  if (!Number.isFinite(range) || range <= 0) return null;
  if (String(dir || "").toUpperCase() === "SHORT") {
    return clamp01((bar.high - bar.close) / range);
  }
  return clamp01((bar.close - bar.low) / range);
}

function oppositeWickRatio(bar, dir) {
  if (!bar) return null;
  const range = bar.high - bar.low;
  if (!Number.isFinite(range) || range <= 0) return null;
  if (String(dir || "").toUpperCase() === "SHORT") {
    const wick = Math.max(0, bar.high - Math.max(bar.open, bar.close));
    return clamp01(wick / range);
  }
  const wick = Math.max(0, Math.min(bar.open, bar.close) - bar.low);
  return clamp01(wick / range);
}

function directionalBodyRatio(bar, dir) {
  if (!bar) return null;
  const range = bar.high - bar.low;
  if (!Number.isFinite(range) || range <= 0) return null;
  const body = String(dir || "").toUpperCase() === "SHORT"
    ? (bar.open - bar.close)
    : (bar.close - bar.open);
  return body / range;
}

function weightedMean(items) {
  const rows = (items || []).filter((x) => Number.isFinite(Number(x.weight)) && Number.isFinite(Number(x.value)));
  if (!rows.length) return null;
  let sumW = 0;
  let sumWV = 0;
  for (const row of rows) {
    const w = Number(row.weight);
    const v = Number(row.value);
    sumW += w;
    sumWV += (w * v);
  }
  if (!Number.isFinite(sumW) || sumW <= 0) return null;
  return sumWV / sumW;
}

function featureNum(features, ...keys) {
  const f = (features && typeof features === "object") ? features : {};
  for (const key of keys) {
    const n = toNum(f[key]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function buildEntryMicroSnapshotFromFeatures(features = {}) {
  const f = (features && typeof features === "object") ? features : {};
  return {
    barsSeen: featureNum(f, "ev_gate_bars_seen", "bars_seen"),
    atrPct: featureNum(f, "ev_gate_atr_pct", "atr_pct"),
    targetAtr: featureNum(f, "ev_gate_target_atr", "target_atr"),
    stopAtr: featureNum(f, "ev_gate_stop_atr", "stop_atr"),
    recentMove3Pct: featureNum(f, "ev_gate_recent_move_3_pct", "recent_move_3_pct"),
    recentMove1Pct: featureNum(f, "ev_gate_recent_move_1_pct", "recent_move_1_pct"),
    chaseRatio: featureNum(f, "ev_gate_chase_ratio", "chase_ratio"),
    sameDirStreak: featureNum(f, "ev_gate_same_dir_streak", "same_dir_streak"),
    counterDirBars: featureNum(f, "ev_gate_counter_dir_bars", "counter_dir_bars"),
    avgCloseControl: featureNum(f, "ev_gate_avg_close_control", "avg_close_control"),
    avgOppWick: featureNum(f, "ev_gate_avg_opposite_wick", "avg_opposite_wick"),
    avgDirBody: featureNum(f, "ev_gate_avg_dir_body", "avg_dir_body"),
    lastCloseControl: featureNum(f, "ev_gate_last_close_control", "last_close_control"),
    lastOppWick: featureNum(f, "ev_gate_last_opposite_wick", "last_opposite_wick"),
    lastDirBody: featureNum(f, "ev_gate_last_dir_body", "last_dir_body"),
    prevCloseControl: featureNum(f, "ev_gate_prev_close_control", "prev_close_control"),
    prevOppWick: featureNum(f, "ev_gate_prev_opposite_wick", "prev_opposite_wick"),
    prevDirBody: featureNum(f, "ev_gate_prev_dir_body", "prev_dir_body"),
  };
}

function buildEntryMicroDetail(prefix, snapshot = {}) {
  const p = String(prefix || "").trim();
  if (!p) return {};
  const keys = {
    barsSeen: `${p}_bars_seen`,
    atrPct: `${p}_atr_pct`,
    targetAtr: `${p}_target_atr`,
    stopAtr: `${p}_stop_atr`,
    recentMove3Pct: `${p}_recent_move_3_pct`,
    recentMove1Pct: `${p}_recent_move_1_pct`,
    chaseRatio: `${p}_chase_ratio`,
    sameDirStreak: `${p}_same_dir_streak`,
    counterDirBars: `${p}_counter_dir_bars`,
    avgCloseControl: `${p}_avg_close_control`,
    avgOppWick: `${p}_avg_opposite_wick`,
    avgDirBody: `${p}_avg_dir_body`,
    lastCloseControl: `${p}_last_close_control`,
    lastOppWick: `${p}_last_opposite_wick`,
    lastDirBody: `${p}_last_dir_body`,
    prevCloseControl: `${p}_prev_close_control`,
    prevOppWick: `${p}_prev_opposite_wick`,
    prevDirBody: `${p}_prev_dir_body`,
  };
  const detail = {};
  for (const [field, key] of Object.entries(keys)) {
    detail[key] = Number.isFinite(Number(snapshot[field])) ? Number(snapshot[field]) : null;
  }
  return detail;
}

function buildEntryMicroSnapshotFromBars({
  bars,
  dir,
  barCloseMs = null,
  lookbackBars = 12,
  atrBars = 8,
} = {}) {
  const direction = String(dir || "").toUpperCase();
  if (direction !== "LONG" && direction !== "SHORT") {
    return { ok: false, skipReason: "BAD_DIR" };
  }
  const normalized = (Array.isArray(bars) ? bars : [])
    .map(normalizeBar)
    .filter(Boolean)
    .filter((b) => !Number.isFinite(barCloseMs) || b.timestamp <= Number(barCloseMs))
    .sort((a, b) => a.timestamp - b.timestamp);

  const needBars = Math.max(8, Number(lookbackBars) || 12, (Number(atrBars) || 8) + 1);
  const scoped = normalized.slice(-needBars);
  if (scoped.length < needBars) {
    return { ok: false, skipReason: "INSUFFICIENT_BARS", barsSeen: scoped.length };
  }

  const atrSlice = scoped.slice(-(Math.max(3, Number(atrBars) || 8) + 1));
  const trPcts = [];
  for (let i = 1; i < atrSlice.length; i += 1) {
    const trPct = trueRangePct(atrSlice[i], atrSlice[i - 1].close);
    if (Number.isFinite(trPct) && trPct > 0) trPcts.push(trPct);
  }
  if (!trPcts.length) {
    return { ok: false, skipReason: "ATR_UNAVAILABLE", barsSeen: scoped.length };
  }
  const atrPct = trPcts.reduce((a, b) => a + b, 0) / trPcts.length;
  if (!Number.isFinite(atrPct) || atrPct <= 0) {
    return { ok: false, skipReason: "ATR_INVALID", barsSeen: scoped.length };
  }

  const last = scoped[scoped.length - 1];
  const moveRef3 = scoped[scoped.length - 4];
  const moveRef1 = scoped[scoped.length - 2];
  const recentMove3Pct = directionalMovePct(moveRef3.close, last.close, direction);
  const recentMove1Pct = directionalMovePct(moveRef1.close, last.close, direction);
  const chaseRatio = Number.isFinite(recentMove3Pct) ? (recentMove3Pct / atrPct) : null;
  const { sameDirStreak, counterDirBars } = computeDirectionalStreak(scoped, direction);

  const featureBars = scoped.slice(-4);
  const avgCloseControl = weightedMean(featureBars.map((bar) => ({ value: closeControlRatio(bar, direction), weight: 1 })));
  const avgOppWick = weightedMean(featureBars.map((bar) => ({ value: oppositeWickRatio(bar, direction), weight: 1 })));
  const avgDirBody = weightedMean(featureBars.map((bar) => ({ value: directionalBodyRatio(bar, direction), weight: 1 })));
  const lastCloseControl = closeControlRatio(last, direction);
  const lastOppWick = oppositeWickRatio(last, direction);
  const lastDirBody = directionalBodyRatio(last, direction);
  const prevBar = scoped[scoped.length - 2] || null;
  const prevCloseControl = closeControlRatio(prevBar, direction);
  const prevOppWick = oppositeWickRatio(prevBar, direction);
  const prevDirBody = directionalBodyRatio(prevBar, direction);

  return {
    ok: true,
    barsSeen: scoped.length,
    atrPct,
    recentMove3Pct,
    recentMove1Pct,
    chaseRatio,
    sameDirStreak,
    counterDirBars,
    avgCloseControl,
    avgOppWick,
    avgDirBody,
    lastCloseControl,
    lastOppWick,
    lastDirBody,
    prevCloseControl,
    prevOppWick,
    prevDirBody,
  };
}

module.exports = {
  buildEntryMicroSnapshotFromBars,
  buildEntryMicroSnapshotFromFeatures,
  buildEntryMicroDetail,
  normalizeBar,
  __test: {
    normalizeBar,
    directionalMovePct,
    trueRangePct,
    computeDirectionalStreak,
    closeControlRatio,
    oppositeWickRatio,
    directionalBodyRatio,
    weightedMean,
    buildEntryMicroSnapshotFromBars,
    buildEntryMicroSnapshotFromFeatures,
    buildEntryMicroDetail,
  },
};
