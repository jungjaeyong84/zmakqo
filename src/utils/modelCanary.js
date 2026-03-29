function clamp01(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function hashToUnitInterval(input) {
  const s = String(input || "");
  if (!s) return Math.random();
  // FNV-1a 32-bit hash for stable bucket split.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const u = (h >>> 0) / 4294967295;
  return clamp01(u, 0);
}

function pickModelCanary({ primaryModel, canaryModel, canaryPct, key }) {
  const primary = String(primaryModel || "").trim();
  const canary = String(canaryModel || "").trim();
  const pct = clamp01(canaryPct, 0);
  if (!primary) {
    return {
      model: canary || "",
      canary_used: !!canary,
      canary_pct: pct,
      bucket: null,
    };
  }
  if (!canary || canary === primary || pct <= 0) {
    return {
      model: primary,
      canary_used: false,
      canary_pct: pct,
      bucket: null,
    };
  }
  const bucket = hashToUnitInterval(key);
  const canaryUsed = bucket < pct;
  return {
    model: canaryUsed ? canary : primary,
    canary_used: canaryUsed,
    canary_pct: pct,
    bucket,
  };
}

module.exports = { pickModelCanary };
