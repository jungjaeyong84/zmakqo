function stripAiReasonPrefix(reason) {
  const src = String(reason || "").trim();
  if (!src) return "";
  const idx = src.indexOf(":");
  if (idx > 0 && idx < 32) {
    const head = src.slice(0, idx).trim();
    if (/^[A-Z_]+$/i.test(head)) return src.slice(idx + 1).trim();
  }
  return src;
}

function splitAiReasonUnits(reason) {
  const src = String(reason || "").trim();
  if (!src) return [];
  const units = [];
  for (const part of src.split("|")) {
    const cleanPart = String(part || "").replace(/\s+/g, " ").trim();
    if (!cleanPart) continue;
    const fragments = cleanPart.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    if (fragments.length) units.push(...fragments);
    else units.push(cleanPart);
  }
  return units;
}

function translateAiReasonUnitKo(unit) {
  const src = String(unit || "").replace(/\s+/g, " ").trim();
  if (!src) return null;
  const exactMap = new Map([
    [
      "Recent headlines indicate a mixed sentiment in the market with no strong directional bias from macroeconomic factors.",
      "최근 헤드라인은 거시 요인 기준 시장 심리가 혼조이며, 뚜렷한 방향 우위가 없음을 시사합니다.",
    ],
    [
      "The focus on index reconstitution and regulatory transparency suggests a cautious approach, leading to a neutral stance.",
      "지수 재편입과 규제 투명성 이슈가 중심이라 공격적 해석보다 신중한 접근이 맞고, 결론은 중립입니다.",
    ],
    [
      "Headlines are mostly index reconstitution docs and Bloomberg data/regulatory PDFs with no actionable macro or crypto-specific news.",
      "헤드라인 대부분이 지수 재편입 문서와 블룸버그 데이터·규제 PDF라서, 바로 매매에 쓸 만한 거시·암호화폐 특화 뉴스는 거의 없습니다.",
    ],
    [
      "No clear signals on rates, USD, equities, credit, or oil.",
      "금리, 달러, 주식, 신용, 유가 쪽에서 방향을 정할 만한 뚜렷한 신호가 없습니다.",
    ],
    [
      "Insufficient information to assess risk-on/off or directional bias.",
      "리스크온/리스크오프나 방향 우위를 판단하기에는 정보가 부족합니다.",
    ],
    [
      "Recent headlines indicate a mixed sentiment in the market with no strong directional bias.",
      "최근 헤드라인은 시장 심리가 혼조이며, 뚜렷한 방향 우위가 없음을 시사합니다.",
    ],
    [
      "Recent headlines indicate a mixed sentiment in the market.",
      "최근 헤드라인은 시장 심리가 혼조임을 시사합니다.",
    ],
    [
      "Recent headlines indicate mixed signals regarding crypto performance, with significant events like the Bitcoin halving potentially influencing market sentiment positively, but macroeconomic factors such as interest rates and USD strength remain uncertain, leading to a cautious outlook.",
      "최근 헤드라인은 암호화폐 흐름에 대해 엇갈린 신호를 보여줍니다. 비트코인 반감기 같은 이벤트는 심리에 긍정적으로 작용할 수 있지만, 금리와 달러 강세 같은 거시 변수는 여전히 불확실해 전체적으로는 신중한 접근이 필요한 국면입니다.",
    ],
    [
      "Headlines are only CoinDesk index methodology docs and old research PDFs (halving, ETH 2.0), containing zero actionable macro or crypto market news.",
      "헤드라인 대부분이 CoinDesk 지수 방법론 문서와 오래된 리서치 PDF(반감기, ETH 2.0)뿐이라, 실제 매매에 바로 활용할 만한 거시·암호화폐 시장 뉴스는 없습니다.",
    ],
    [
      "No data on rates, USD, equities, credit, or oil.",
      "금리, 달러, 주식, 신용, 유가에 대해 새롭게 방향을 정할 만한 데이터가 없습니다.",
    ],
    [
      "Insufficient signal to assess risk-on/off or directional bias.",
      "리스크온·리스크오프나 방향 우위를 판단하기에는 신호가 부족합니다.",
    ],
    [
      "Recent headlines indicate mixed signals with Bitcoin experiencing volatility and uncertainty due to macroeconomic factors such as high real yields and Fed rate concerns.",
      "최근 헤드라인은 엇갈린 신호를 보여주며, 비트코인은 높은 실질금리와 연준 금리 우려 같은 거시 요인 때문에 변동성과 불확실성이 커진 상태입니다.",
    ],
    [
      "The market appears to be in a range-bound state, reflecting a cautious sentiment among investors.",
      "시장은 박스권 흐름으로 보이며, 투자자 심리는 전반적으로 신중합니다.",
    ],
    [
      "BTC volatile between $74K-$93K with heavy liquidations.",
      "비트코인은 7만4천 달러에서 9만3천 달러 구간에서 크게 흔들렸고, 강한 청산이 동반됐습니다.",
    ],
    [
      "High real yields, Fed uncertainty, and rising Treasury supply pressure risk assets.",
      "높은 실질금리, 연준 불확실성, 국채 발행 증가가 위험자산에 부담을 주고 있습니다.",
    ],
    [
      "Failed safe-haven test amid geopolitical stress.",
      "지정학적 긴장 속에서도 안전자산 역할은 확인되지 못했습니다.",
    ],
    [
      "ETF inflows provide support but macro headwinds (USD strength, elevated yields, oil volatility) dominate.",
      "ETF 자금 유입은 지지 요인이지만, 달러 강세와 높은 금리, 유가 변동성 같은 거시 역풍이 더 크게 작용하고 있습니다.",
    ],
  ]);
  if (exactMap.has(src)) return exactMap.get(src);

  let out = src;
  const replacements = [
    [/Recent headlines indicate/gi, "최근 헤드라인은"],
    [/Recent headlines indicate mixed signals with Bitcoin experiencing volatility and uncertainty due to macroeconomic factors such as high real yields and Fed rate concerns/gi, "최근 헤드라인은 엇갈린 신호를 보여주며, 비트코인은 높은 실질금리와 연준 금리 우려 같은 거시 요인 때문에 변동성과 불확실성이 커진 상태입니다"],
    [/mixed signals regarding crypto performance/gi, "암호화폐 흐름에 대해 엇갈린 신호를 보여주며"],
    [/The market appears to be in a range-bound state, reflecting a cautious sentiment among investors/gi, "시장은 박스권 흐름으로 보이며, 투자자 심리는 전반적으로 신중합니다"],
    [/BTC volatile between \$74K-\$93K with heavy liquidations/gi, "비트코인은 7만4천 달러에서 9만3천 달러 구간에서 크게 흔들렸고, 강한 청산이 동반됐습니다"],
    [/High real yields, Fed uncertainty, and rising Treasury supply pressure risk assets/gi, "높은 실질금리, 연준 불확실성, 국채 발행 증가가 위험자산에 부담을 주고 있습니다"],
    [/Failed safe-haven test amid geopolitical stress/gi, "지정학적 긴장 속에서도 안전자산 역할은 확인되지 못했습니다"],
    [/ETF inflows provide support but macro headwinds \(USD strength, elevated yields, oil volatility\) dominate/gi, "ETF 자금 유입은 지지 요인이지만, 달러 강세와 높은 금리, 유가 변동성 같은 거시 역풍이 더 크게 작용하고 있습니다"],
    [/Range-bound conditions favor reduce.*$/gi, "박스권 장세에서는 추격 진입보다 비중 축소와 선별 진입이 유리합니다"],
    [/mixed sentiment in the market/gi, "시장 심리가 혼조임을"],
    [/mixed sentiment/gi, "혼조 심리를"],
    [/significant events like the Bitcoin halving potentially influencing market sentiment positively/gi, "비트코인 반감기 같은 이벤트가 심리에 긍정적으로 작용할 수 있지만"],
    [/macroeconomic factors such as interest rates and USD strength remain uncertain/gi, "금리와 달러 강세 같은 거시 변수는 여전히 불확실하고"],
    [/leading to a cautious outlook/gi, "전체적으로는 신중한 접근이 필요한 국면입니다"],
    [/with no strong directional bias from macroeconomic factors/gi, "거시 요인 기준 뚜렷한 방향 우위가 없음을"],
    [/with no strong directional bias/gi, "뚜렷한 방향 우위가 없음을"],
    [/from macroeconomic factors/gi, "거시 요인 기준"],
    [/The focus on/gi, ""],
    [/index reconstitution/gi, "지수 재편입"],
    [/regulatory transparency/gi, "규제 투명성"],
    [/suggests a cautious approach, leading to a neutral stance/gi, "때문에 신중한 접근이 맞고, 결론은 중립입니다"],
    [/suggests a cautious approach/gi, "때문에 신중한 접근이 맞습니다"],
    [/leading to a neutral stance/gi, "결론은 중립입니다"],
    [/Headlines are only/gi, "헤드라인 대부분이"],
    [/Headlines are mostly/gi, "헤드라인 대부분이"],
    [/CoinDesk index methodology docs and old research PDFs \(halving, ETH 2\.0\)/gi, "CoinDesk 지수 방법론 문서와 오래된 리서치 PDF(반감기, ETH 2.0)"],
    [/Bloomberg data\/regulatory PDFs/gi, "블룸버그 데이터·규제 PDF"],
    [/containing zero actionable macro or crypto market news/gi, "실제 매매에 바로 활용할 만한 거시·암호화폐 시장 뉴스는 없다는 뜻입니다"],
    [/with no actionable macro or crypto-specific news/gi, "바로 매매에 쓸 만한 거시·암호화폐 특화 뉴스가 거의 없다는 뜻입니다"],
    [/No data on/gi, ""],
    [/No clear signals on/gi, ""],
    [/rates, USD, equities, credit, or oil/gi, "금리, 달러, 주식, 신용, 유가"],
    [/Insufficient signal to assess/gi, ""],
    [/Insufficient information to assess/gi, ""],
    [/risk-on\/off or directional bias/gi, "리스크온/리스크오프나 방향 우위"],
  ];
  for (const [pattern, repl] of replacements) out = out.replace(pattern, repl);
  out = out.replace(/\s+/g, " ").replace(/\s+,/g, ",").trim();
  if (out === src) return null;

  if (out.startsWith("최근 헤드라인은") && !/[.?!]$/.test(out)) out += " 시사합니다.";
  if (out.startsWith("헤드라인 대부분이") && !/[.?!]$/.test(out)) out += ".";
  if (out.startsWith("금리, 달러, 주식, 신용, 유가") && !/[.?!]$/.test(out)) out += " 쪽에서 뚜렷한 신호가 없습니다.";
  if (out.startsWith("리스크온/리스크오프나 방향 우위") && !/[.?!]$/.test(out)) out += "를 판단하기에는 정보가 부족합니다.";
  return out;
}

function buildAiReasonKoFallback(src) {
  const lower = src.toLowerCase();
  const details = [];
  const hasHeadlines = lower.includes("headline");
  const hasMixed = lower.includes("mixed sentiment");
  const hasRecovery = lower.includes("recovery") || lower.includes("rebound");
  const hasFragile = lower.includes("fragile") || lower.includes("vulnerable");
  const hasMacro = lower.includes("macro") || lower.includes("macroeconomic");
  const hasVolatility = lower.includes("volatility");
  const hasRegulation = lower.includes("regulation") || lower.includes("policy");
  const hasAlt = lower.includes("altcoin");

  if (hasMixed) details.push("시장 심리가 한쪽으로 정렬되지 않았고, 상승·하락 재료가 동시에 존재합니다.");
  if (hasRecovery) details.push("비트코인은 단기 반등 흐름이 있으나, 중기 추세 전환으로 확정된 단계는 아닙니다.");
  if (hasFragile) details.push("반등 기반이 약해 작은 악재에도 되돌림이 크게 나올 수 있습니다.");
  if (hasMacro) details.push("금리·유동성·달러 강세 같은 거시 변수 영향이 커서 방향성이 쉽게 흔들릴 수 있습니다.");
  if (hasVolatility) details.push("변동성 확대 구간으로, 진입보다 손절/포지션 크기 관리가 성과에 더 큰 영향을 줍니다.");
  if (hasRegulation) details.push("정책·규제 뉴스가 리스크 프리미엄을 높일 수 있어 이벤트 구간 추격 진입은 주의가 필요합니다.");
  if (hasAlt) details.push("알트코인은 비트코인 대비 변동폭이 커서 같은 방향이라도 손익 분산이 더 큽니다.");
  if (!details.length) details.push("현재 AI 요약은 단기 반등 신호와 거시 불확실성이 공존하는 국면으로 해석됩니다.");

  let summaryKo = "최근 뉴스 기준 암호화폐 시장은 혼조 심리이며, 단기 반등과 거시 불확실성이 동시에 작용하고 있습니다.";
  if (hasMixed && hasRecovery && hasFragile) {
    summaryKo = "최근 뉴스 기준 시장 심리는 혼조입니다. 비트코인은 반등했지만, 거시 불확실성으로 아직 취약한 상태입니다.";
  } else if (hasRecovery && hasMacro) {
    summaryKo = "비트코인 반등 신호는 있으나, 거시 변수 부담으로 추세 신뢰도는 아직 낮습니다.";
  } else if (lower.includes("risk-off")) {
    summaryKo = "시장 리스크 회피 성향이 높아져 공격적 진입보다 방어적 운용이 유리한 구간입니다.";
  }

  const translationParts = [];
  if (hasHeadlines && hasMixed) {
    translationParts.push("최근 헤드라인은 암호화폐 시장 심리가 혼재되어 있음을 시사합니다.");
  } else if (hasMixed) {
    translationParts.push("암호화폐 시장은 상승·하락 재료가 공존하는 혼조 심리 구간입니다.");
  }
  if (hasRecovery && hasFragile && hasMacro) {
    translationParts.push("비트코인은 일부 회복 흐름을 보이지만, 거시경제 우려로 여전히 취약한 상태입니다.");
  } else if (hasRecovery && hasFragile) {
    translationParts.push("비트코인은 반등했지만 아직 기반이 약해 추가 변동에 취약합니다.");
  } else if (hasRecovery) {
    translationParts.push("비트코인은 단기 회복 흐름을 보이고 있습니다.");
  }
  if (hasMacro && !hasRecovery) {
    translationParts.push("거시경제 변수 영향이 커 방향성 불확실성이 높습니다.");
  }
  if (hasVolatility) {
    translationParts.push("변동성 확대에 대비한 리스크 관리가 필요합니다.");
  }
  if (!translationParts.length) translationParts.push(summaryKo);

  return {
    summary_ko: summaryKo,
    details_ko: details.slice(0, 5),
    source_en: src,
    translation_ko: translationParts.join(" "),
  };
}

function buildAiReasonKo(reason) {
  const src = stripAiReasonPrefix(reason);
  if (!src) {
    return {
      summary_ko: null,
      details_ko: [],
      source_en: null,
      translation_ko: null,
    };
  }
  const units = splitAiReasonUnits(src);
  const translatedUnits = units.map((unit) => translateAiReasonUnitKo(unit)).filter(Boolean);
  if (translatedUnits.length) {
    return {
      summary_ko: translatedUnits[0],
      details_ko: translatedUnits.slice(1, 5),
      source_en: src,
      translation_ko: translatedUnits.join(" "),
    };
  }
  return buildAiReasonKoFallback(src);
}

function reasonSummaryKo(reason) {
  const ko = buildAiReasonKo(reason);
  return ko && ko.summary_ko ? ko.summary_ko : "방향 확신이 낮아 중립 판단입니다.";
}

module.exports = {
  stripAiReasonPrefix,
  splitAiReasonUnits,
  translateAiReasonUnitKo,
  buildAiReasonKo,
  buildAiReasonKoFallback,
  reasonSummaryKo,
};
