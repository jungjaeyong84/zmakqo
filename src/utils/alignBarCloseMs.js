// src/utils/alignBarCloseMs.js
// Normalize bar close timestamps to exchange tf boundaries when misaligned.

const { tfToMs } = require("./marketConfig");

function shouldAlignExchange(exchange) {
  const ex = String(exchange || "").toUpperCase();
  return ex === "BINANCEFUT";
}

function normalizeAlignMode(raw, fallback = "FLOOR") {
  const mode = String(raw || "").trim().toUpperCase();
  if (mode === "FLOOR" || mode === "ROUND" || mode === "CEIL" || mode === "NONE") return mode;
  return fallback;
}

function resolveAlignMode(exchange) {
  if (!shouldAlignExchange(exchange)) return "NONE";
  return normalizeAlignMode(
    process.env.BAR_ALIGN_MODE_BINANCEFUT || process.env.BAR_ALIGN_MODE,
    "FLOOR"
  );
}

function alignWithMode(barCloseMs, tfMs, mode) {
  if (!Number.isFinite(barCloseMs) || !Number.isFinite(tfMs) || tfMs <= 0) return barCloseMs;
  const normalizedMode = normalizeAlignMode(mode, "FLOOR");
  if (normalizedMode === "NONE") return barCloseMs;
  if (normalizedMode === "ROUND") return Math.round(barCloseMs / tfMs) * tfMs;
  if (normalizedMode === "CEIL") return Math.ceil(barCloseMs / tfMs) * tfMs;
  return Math.floor(barCloseMs / tfMs) * tfMs;
}

function alignBarCloseMs(exchange, tf, barCloseMs) {
  if (!Number.isFinite(barCloseMs)) return barCloseMs;
  if (!shouldAlignExchange(exchange)) return barCloseMs;

  const tfMs = tfToMs(tf);
  if (!Number.isFinite(tfMs) || tfMs <= 0) return barCloseMs;

  return alignWithMode(barCloseMs, tfMs, resolveAlignMode(exchange));
}

module.exports = {
  alignBarCloseMs,
  resolveAlignMode,
  alignWithMode,
};
