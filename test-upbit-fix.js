// 업비트 API 수정 사항 테스트 스크립트
const { fetchUpbitCandles60m } = require("./src/exchanges/upbit");
const { fetchBarCloseTime } = require("./src/utils/barTimeFetch");

async function testUpbitFix() {
  console.log("=".repeat(60));
  console.log("돈벌자 업비트 API 수정 사항 테스트");
  console.log("=".repeat(60));
  console.log();

  try {
    // 테스트 1: fetchUpbitCandles60m - timestamp 필드 확인
    console.log("[테스트 1] fetchUpbitCandles60m - timestamp 필드 확인");
    console.log("-".repeat(60));
    const candles = await fetchUpbitCandles60m("KRW-BTC", 2);

    console.log(`✅ 캔들 ${candles.length}개 수신`);
    console.log();

    if (candles.length > 0) {
      const c = candles[0];
      console.log("첫 번째 캔들 구조:");
      console.log("  - timestamp:", c.timestamp, typeof c.timestamp === "number" ? "✅" : "❌");
      console.log("  - closeTimeUtcMs:", c.closeTimeUtcMs, typeof c.closeTimeUtcMs === "number" ? "✅" : "❌");
      console.log("  - closeTimeUtc:", c.closeTimeUtc, c.closeTimeUtc ? "✅" : "❌");
      console.log("  - raw:", c.raw ? "✅ 존재" : "❌ 없음");
      console.log("  - t:", c.t, c.t ? "✅" : "❌");
      console.log("  - o/h/l/c/v:", c.o, c.h, c.l, c.c, c.v);
      console.log();

      // 타임스탬프 유효성 확인
      if (typeof c.timestamp === "number" && Number.isFinite(c.timestamp)) {
        const date = new Date(c.timestamp);
        console.log("  타임스탬프 변환:", date.toISOString());
        console.log("  ✅ timestamp 필드가 올바르게 설정됨");
      } else {
        console.log("  ❌ timestamp 필드가 올바르지 않음");
      }
    }
    console.log();

    // 테스트 2: fetchBarCloseTime 유틸리티 함수
    console.log("[테스트 2] fetchBarCloseTime 유틸리티 함수");
    console.log("-".repeat(60));
    const result = await fetchBarCloseTime("KRW-BTC", 3, 600);

    if (result.success) {
      console.log("✅ fetchBarCloseTime 성공");
      console.log("  - ms:", result.ms);
      console.log("  - iso:", result.iso);
      console.log("  - n:", result.n);
      console.log("  - attempt:", result.attempt);
      console.log();

      const date = new Date(result.ms);
      console.log("  변환된 날짜:", date.toISOString());
      console.log("  ✅ 유틸리티 함수 정상 작동");
    } else {
      console.log("❌ fetchBarCloseTime 실패");
      console.log("  - error:", result.errorMessage);
    }
    console.log();

    // 테스트 3: 데이터 일관성 확인
    console.log("[테스트 3] 데이터 일관성 확인");
    console.log("-".repeat(60));

    if (candles.length > 0 && result.success) {
      const candleMs = candles[0].timestamp;
      const utilMs = result.ms;

      if (candleMs === utilMs) {
        console.log("✅ 두 방법의 타임스탬프가 일치:", candleMs);
      } else {
        console.log("⚠️  타임스탬프 불일치:");
        console.log("  - candles[0].timestamp:", candleMs);
        console.log("  - fetchBarCloseTime.ms:", utilMs);
        console.log("  - 차이:", Math.abs(candleMs - utilMs), "ms");
      }
    }
    console.log();

    // 종합 결과
    console.log("=".repeat(60));
    console.log("종합 결과");
    console.log("=".repeat(60));

    const checksPass = [
      candles.length > 0,
      candles[0].timestamp && typeof candles[0].timestamp === "number",
      candles[0].closeTimeUtcMs && typeof candles[0].closeTimeUtcMs === "number",
      candles[0].raw !== undefined,
      result.success
    ];

    const passCount = checksPass.filter(Boolean).length;
    const totalCount = checksPass.length;

    console.log(`통과: ${passCount}/${totalCount}`);

    if (passCount === totalCount) {
      console.log("✅ 모든 테스트 통과! 시스템이 정상적으로 작동할 것으로 예상됩니다.");
    } else {
      console.log("⚠️  일부 테스트 실패. 추가 디버깅이 필요합니다.");
    }
    console.log();

  } catch (error) {
    console.error("❌ 테스트 중 오류 발생:");
    console.error(error);
    process.exit(1);
  }
}

testUpbitFix()
  .then(() => {
    console.log("테스트 완료");
    process.exit(0);
  })
  .catch((err) => {
    console.error("테스트 실패:", err);
    process.exit(1);
  });
