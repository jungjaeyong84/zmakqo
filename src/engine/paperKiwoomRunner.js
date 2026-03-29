// src/engine/paperKiwoomRunner.js
// Kiwoom PAPER runner: Upbit paper 러너 로직을 재사용해 확정봉 기반 집행을 수행한다.
// Paper/Mock 단계에서는 내부 체결 모델(next_open)을 사용한다.

const { runPaperUpbitForBar } = require("./paperUpbitRunner");

async function runPaperKiwoomForBar(opts = {}) {
  const merged = { ...opts, exchange: "KIWOOM" };
  return runPaperUpbitForBar(merged);
}

module.exports = { runPaperKiwoomForBar };
