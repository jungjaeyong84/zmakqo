const assert = require("assert");
const homeRoute = require("../routes/dashboard.home.routes");
const aiReasonKo = require("../utils/aiReasonKo");

const { buildAiReasonKo } = homeRoute.__test || {};
const { reasonSummaryKo } = aiReasonKo || {};

(() => {
  assert.ok(typeof buildAiReasonKo === "function");

  const raw = [
    "Recent headlines indicate a mixed sentiment in the market with no strong directional bias from macroeconomic factors.",
    "The focus on index reconstitution and regulatory transparency suggests a cautious approach, leading to a neutral stance.",
    "Headlines are mostly index reconstitution docs and Bloomberg data/regulatory PDFs with no actionable macro or crypto-specific news.",
    "No clear signals on rates, USD, equities, credit, or oil.",
    "Insufficient information to assess risk-on/off or directional bias.",
  ].join("|");

  const ko = buildAiReasonKo(raw);
  assert.ok(ko);
  assert.ok(ko.summary_ko.includes("최근 헤드라인은"));
  assert.ok(ko.translation_ko.includes("지수 재편입"));
  assert.ok(ko.translation_ko.includes("금리, 달러, 주식, 신용, 유가"));
  assert.ok(Array.isArray(ko.details_ko));
  assert.ok(ko.details_ko.length >= 2);
  assert.ok(!ko.translation_ko.includes("최근 뉴스 기준 암호화폐 시장은 혼조 심리이며"));

  console.log("AI_REASON_KO_TEST_OK");
})();

(() => {
  const raw = [
    "Recent headlines indicate mixed signals regarding crypto performance, with significant events like the Bitcoin halving potentially influencing market sentiment positively, but macroeconomic factors such as interest rates and USD strength remain uncertain, leading to a cautious outlook.",
    "Headlines are only CoinDesk index methodology docs and old research PDFs (halving, ETH 2.0), containing zero actionable macro or crypto market news.",
    "No data on rates, USD, equities, credit, or oil.",
    "Insufficient signal to assess risk-on/off or directional bias.",
  ].join("|");

  const ko = buildAiReasonKo(raw);
  assert.ok(ko);
  assert.ok(ko.summary_ko.includes("암호화폐 흐름"));
  assert.ok(ko.translation_ko.includes("비트코인 반감기"));
  assert.ok(ko.translation_ko.includes("CoinDesk 지수 방법론"));
  assert.ok(ko.translation_ko.includes("금리, 달러, 주식, 신용, 유가"));
  assert.ok(!ko.translation_ko.includes("No data on"));
  assert.ok(!ko.translation_ko.includes("Insufficient signal"));
  assert.ok(!ko.translation_ko.includes("mixed signals"));
})();

(() => {
  assert.ok(typeof reasonSummaryKo === "function");
  const raw = [
    "Recent headlines indicate mixed signals regarding crypto performance, with significant events like the Bitcoin halving potentially influencing market sentiment positively, but macroeconomic factors such as interest rates and USD strength remain uncertain, leading to a cautious outlook.",
    "Headlines are only CoinDesk index methodology docs and old research PDFs (halving, ETH 2.0), containing zero actionable macro or crypto market news.",
  ].join("|");
  const summary = reasonSummaryKo(raw);
  assert.ok(summary.includes("암호화폐 흐름"));
  assert.ok(!summary.includes("방향 확신이 낮아 중립 판단입니다."));
})();

(() => {
  const raw = [
    "Recent headlines indicate mixed signals with Bitcoin experiencing volatility and uncertainty due to macroeconomic factors such as high real yields and Fed rate concerns.",
    "The market appears to be in a range-bound state, reflecting a cautious sentiment among investors.",
    "BTC volatile between $74K-$93K with heavy liquidations.",
    "High real yields, Fed uncertainty, and rising Treasury supply pressure risk assets.",
    "Failed safe-haven test amid geopolitical stress.",
    "ETF inflows provide support but macro headwinds (USD strength, elevated yields, oil volatility) dominate.",
  ].join("|");

  const ko = buildAiReasonKo(raw);
  assert.ok(ko.summary_ko.includes("높은 실질금리"));
  assert.ok(ko.translation_ko.includes("박스권 흐름"));
  assert.ok(ko.translation_ko.includes("강한 청산"));
  assert.ok(ko.translation_ko.includes("국채 발행 증가"));
  assert.ok(ko.translation_ko.includes("안전자산 역할"));
  assert.ok(ko.translation_ko.includes("ETF 자금 유입"));
  assert.ok(Array.isArray(ko.details_ko));
  assert.ok(ko.details_ko.length >= 3);
  assert.ok(!ko.translation_ko.includes("High real yields"));
  assert.ok(!ko.translation_ko.includes("ETF inflows provide support"));
})();
