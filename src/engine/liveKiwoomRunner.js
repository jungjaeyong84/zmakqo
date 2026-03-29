// src/engine/liveKiwoomRunner.js
// Kiwoom LIVE runner: 현재는 paper 러너를 재사용하여 Live 호출을 막는다.
// 실제 LIVE 주문 연동 시 runPaperKiwoomForBar를 교체/확장하면 된다.

const { runPaperKiwoomForBar } = require("./paperKiwoomRunner");
const { placeOrder, cancelOrder, fetchAccount } = require("../exchanges/kiwoomRest");

/**
 * 간단한 LIVE 러너 (베타)
 * - 신호를 Intent로 변환하는 구간은 paper runner 재사용
 * - Intent를 실제 주문으로 전송 (MARKET only)
 * - 체결/잔고 조회는 fetchAccount로 최소 확인 (미체결/체결 상세 TR은 추후 확장)
 */
async function runLiveKiwoomForBar(opts = {}) {
  const merged = { ...opts, exchange: "KIWOOM", execution_mode: "LIVE" };
  // 1) paper 러너로 intents 생성 (signals->intents)
  const paperResult = await runPaperKiwoomForBar(merged);
  if (paperResult.error && paperResult.error !== "KIWOOM_PAPER_NOT_IMPLEMENTED") return paperResult;

  // paperResult가 내부에서 intents를 생성/DB 반영하지만, 여기서는 간단히 주문 예시만 전송 (실사용 시 intent 로드 필요)
  // 안전하게 no-op 유지
  return { ok: true, message: "LIVE_KIWOOM_PLACEHOLDER (주문/체결 세부 로직 확장 필요)" };
}

module.exports = { runLiveKiwoomForBar };
