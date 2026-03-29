// src/utils/krxCalendar.js
// KRX 거래시간/공휴일 판별 (KST 기준)

let Holidays = null;
try { Holidays = require("date-holidays"); } catch (_) {}

const fs = require("fs");
const path = require("path");

function pad2(n) {
  return String(n).padStart(2, "0");
}

function loadFallbackHolidaySet() {
  // 우선순위: ENV -> config/krx_holidays.json
  const envRaw = String(process.env.KRX_HOLIDAYS || "").trim();
  if (envRaw) {
    const set = new Set(envRaw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean));
    return set.size ? set : null;
  }
  try {
    const p = path.join(process.cwd(), "config", "krx_holidays.json");
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, "utf8"));
      if (Array.isArray(raw)) {
        const set = new Set(raw.map((s) => String(s).trim()).filter(Boolean));
        return set.size ? set : null;
      }
    }
  } catch (_) {}
  return null;
}

const fallbackHolidaySet = loadFallbackHolidaySet();
const hd = Holidays ? new Holidays("KR") : null;

function toKstParts(nowMs = Date.now()) {
  const kst = new Date(nowMs + 9 * 60 * 60 * 1000);
  return {
    y: kst.getUTCFullYear(),
    m: kst.getUTCMonth() + 1,
    d: kst.getUTCDate(),
    day: kst.getUTCDay(),
    hh: kst.getUTCHours(),
    mm: kst.getUTCMinutes(),
  };
}

function isKrxHolidayKst(nowMs = Date.now()) {
  const { y, m, d } = toKstParts(nowMs);
  const dateStr = `${y}-${pad2(m)}-${pad2(d)}`;
  if (hd) {
    try {
      return !!hd.isHoliday(dateStr);
    } catch (_) {}
  }
  if (fallbackHolidaySet) return fallbackHolidaySet.has(dateStr);
  return false;
}

function isKrxMarketOpenKst(nowMs = Date.now()) {
  const { day, hh, mm } = toKstParts(nowMs);
  if (day === 0 || day === 6) return false;
  if (isKrxHolidayKst(nowMs)) return false;
  const mins = hh * 60 + mm;
  const open = 9 * 60;
  const close = 15 * 60 + 30;
  return mins >= open && mins < close;
}

module.exports = { isKrxMarketOpenKst, isKrxHolidayKst, toKstParts };
