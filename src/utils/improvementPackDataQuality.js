function mapSnapshotBarsForPack(bars = [], market, baseTfMs, fromMs, toMsVal) {
  return (Array.isArray(bars) ? bars : [])
    .map((b) => ({
      market,
      close_ms: Number(b.closeTimeUtcMs),
      close_utc: b.closeTimeUtc,
      created_at_ms: Number(b.created_at_ms),
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
      volume: Number(b.volume),
    }))
    .filter((b) => Number.isFinite(b.close_ms) && (b.close_ms % baseTfMs === 0) && b.close_ms >= fromMs && b.close_ms < toMsVal)
    .sort((a, b) => a.close_ms - b.close_ms);
}

function buildImprovementPackDataQuality(barsByMarket, baseTfMs, toKstStringFromMs) {
  const dataQuality = {
    markets: {},
    summary: { missing: 0, duplicate: 0, delayed: 0, outlier: 0, misaligned: 0 },
  };
  for (const [mk, bars] of Object.entries(barsByMarket || {})) {
    let missing = 0;
    let duplicate = 0;
    let delayed = 0;
    let outlier = 0;
    let misaligned = 0;
    const gaps = [];
    let prev = null;
    for (const b of Array.isArray(bars) ? bars : []) {
      if (prev !== null) {
        const gap = b.close_ms - prev;
        if (gap > baseTfMs) {
          const missingBars = Math.floor(gap / baseTfMs) - 1;
          missing += missingBars;
          gaps.push({
            from_utc_ms: prev + baseTfMs,
            to_utc_ms: b.close_ms - baseTfMs,
            from_kst: toKstStringFromMs(prev + baseTfMs),
            to_kst: toKstStringFromMs(b.close_ms - baseTfMs),
            missing_bars: missingBars,
          });
        }
        if (gap === 0) duplicate += 1;
      }
      if (Number.isFinite(b.created_at_ms)) {
        const delay = b.created_at_ms - b.close_ms;
        if (delay > 15 * 60 * 1000) delayed += 1;
      }
      if (!Number.isFinite(b.close_ms) || (b.close_ms % baseTfMs !== 0)) misaligned += 1;
      if (b.high < b.low || b.volume < 0) outlier += 1;
      prev = b.close_ms;
    }
    dataQuality.markets[mk] = { missing, duplicate, delayed, outlier, misaligned, gaps };
    dataQuality.summary.missing += missing;
    dataQuality.summary.duplicate += duplicate;
    dataQuality.summary.delayed += delayed;
    dataQuality.summary.outlier += outlier;
    dataQuality.summary.misaligned += misaligned;
  }
  return dataQuality;
}

module.exports = {
  mapSnapshotBarsForPack,
  buildImprovementPackDataQuality,
};
