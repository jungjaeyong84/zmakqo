// src/utils/barTimeFetch.js
// 중복된 bar close time fetching 로직을 단일 유틸리티로 통합
const { defaultExecTfFromEnv } = require("../utils/marketConfig");

/**
 * 업비트에서 최신 캔들의 bar close time을 가져옵니다.
 * Rate limit 발생 시 자동으로 재시도합니다.
 *
 * @param {string} market - 마켓 코드 (예: "KRW-BTC")
 * @param {number} retries - 최대 재시도 횟수 (기본값: 3)
 * @param {number} delayMs - 재시도 간 대기 시간 (기본값: 600ms)
 * @param {string} tf - 타임프레임 (기본값: 현재 exec tf 또는 "15m")
 * @returns {Promise<Object>} 결과 객체 { success, ms, iso, n, attempt } 또는 { success: false, error, errorMessage }
 */
async function fetchBarCloseTime(market, retries = 3, delayMs = 600) {
  const { fetchCandles, normalizeExchangeId } = require("../exchanges");

  let exchange = "BINANCEFUT";
  let mk = market;
  let retryN = retries;
  let delay = delayMs;
  let tf = defaultExecTfFromEnv() || "15m";

  if (market && typeof market === "object") {
    const obj = market;
    mk = obj.market || obj.symbol || "";
    exchange = normalizeExchangeId(obj.exchange || "BINANCEFUT");
    if (obj.retries != null) retryN = obj.retries;
    if (obj.delayMs != null) delay = obj.delayMs;
    if (obj.tf) tf = String(obj.tf);
  }

  let lastError = null;

  for (let attempt = 0; attempt < retryN; attempt++) {
    try {
      const raw = await fetchCandles(exchange, String(mk), tf, 2);

      if (!raw || !raw.length) {
        throw new Error("NO_CANDLES_RETURNED");
      }

      let bestRow = null;
      let bestMs = null;

      for (const row of raw) {
        if (!row) continue;
        const iso = row.closeTimeUtc || row.t || null;
        const ms =
          (Number.isFinite(row.closeTimeUtcMs) ? row.closeTimeUtcMs : null) ||
          (iso ? Date.parse(String(iso)) : null) ||
          row.timestamp ||
          row.lastUpdatedMs ||
          null;

        if (!Number.isFinite(ms)) continue;
        if (!Number.isFinite(bestMs) || ms > bestMs) {
          bestMs = ms;
          bestRow = row;
        }
      }

      if (Number.isFinite(bestMs)) {
        const iso = bestRow.closeTimeUtc || bestRow.t || null;
        return {
          success: true,
          ms: bestMs,
          iso,
          n: raw.length,
          attempt: attempt + 1
        };
      }

      throw new Error("TIMESTAMP_NOT_FOUND");

    } catch (e) {
      lastError = e;
      const msg = (e && e.message) ? e.message : String(e);

      // Rate limit 처리 - 429 에러 또는 too_many_requests 메시지 확인
      if (msg.includes("429") || msg.includes("too_many_requests")) {
        const waitTime = delay * (attempt + 1);
        console.log(`[barTimeFetch] Rate limit hit for ${mk}, waiting ${waitTime}ms (attempt ${attempt + 1}/${retryN})`);
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }

      // 다른 에러는 즉시 중단
      console.error(`[barTimeFetch] Fatal error for ${mk}:`, msg);
      break;
    }
  }

  return {
    success: false,
    error: lastError,
    errorMessage: (lastError && lastError.message) ? lastError.message : String(lastError)
  };
}

module.exports = { fetchBarCloseTime };
