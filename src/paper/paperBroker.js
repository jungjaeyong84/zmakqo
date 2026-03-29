/**
 * paperBroker shim
 * 목적: 서버 부팅을 막는 MODULE_NOT_FOUND 제거.
 * 실제 paper broker 구현이 다른 파일에 있으면 여기서 갈아끼우면 됨.
 */

function notReady(name) {
  const err = new Error("paperBroker not wired: " + name);
  err.code = "PAPER_BROKER_NOT_WIRED";
  throw err;
}

// runner/pipeline에서 흔히 기대하는 형태들을 넓게 제공
function createPaperBroker() {
  return {
    planIntent: (...args) => notReady("planIntent"),
    placeIntent: (...args) => notReady("placeIntent"),
    fillFromBars: (...args) => notReady("fillFromBars"),
    getState: (...args) => notReady("getState"),
  };
}

module.exports = {
  createPaperBroker,
};
