const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toKstStringFromMs(ms, { fallback = null, fallbackToString = false } = {}) {
  if (!Number.isFinite(ms)) return fallbackToString ? String(ms) : fallback;
  const k = new Date(ms + KST_OFFSET_MS);
  return `${k.getUTCFullYear()}-${pad2(k.getUTCMonth() + 1)}-${pad2(k.getUTCDate())} ${pad2(k.getUTCHours())}:${pad2(k.getUTCMinutes())}:${pad2(k.getUTCSeconds())} KST`;
}

function toKstString(value, opts = {}) {
  let ms = null;
  if (Number.isFinite(value)) {
    ms = Number(value);
  } else {
    ms = Date.parse(String(value || ""));
  }
  if (!Number.isFinite(ms)) {
    if (opts && opts.fallbackToString) return String(value);
    return opts && Object.prototype.hasOwnProperty.call(opts, "fallback") ? opts.fallback : null;
  }
  return toKstStringFromMs(ms, opts);
}

function kstDateParts(d) {
  const k = new Date(d.getTime() + KST_OFFSET_MS);
  return {
    y: k.getUTCFullYear(),
    m: k.getUTCMonth(),
    d: k.getUTCDate(),
    day: k.getUTCDay(),
  };
}

function kstStartOfDay(d) {
  const { y, m, d: dd } = kstDateParts(d);
  const kstMidnightUTC = Date.UTC(y, m, dd, 0, 0, 0);
  return new Date(kstMidnightUTC - KST_OFFSET_MS);
}

function kstStartOfDayMs(ms) {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const start = kstStartOfDay(d);
  return start.getTime();
}

function kstDateKey(value) {
  let ms = null;
  if (Number.isFinite(value)) {
    ms = Number(value);
  } else {
    ms = Date.parse(String(value || ""));
  }
  if (!Number.isFinite(ms)) return null;
  const k = new Date(ms + KST_OFFSET_MS);
  return `${k.getUTCFullYear()}-${pad2(k.getUTCMonth() + 1)}-${pad2(k.getUTCDate())}`;
}

module.exports = {
  KST_OFFSET_MS,
  toKstStringFromMs,
  toKstString,
  kstDateParts,
  kstStartOfDay,
  kstStartOfDayMs,
  kstDateKey,
};
