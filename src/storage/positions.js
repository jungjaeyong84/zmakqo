let impl = null;

try {
  // 기존 프로젝트에 대부분 존재
  impl = require("./positionsPaper");
} catch (_) {
  impl = null;
}

function pick(...fns) {
  for (const fn of fns) if (typeof fn === "function") return fn;
  return null;
}

// 가능한 함수명들을 넓게 잡아서 alias 처리
const getPosition =
  impl && pick(
    impl.getPosition,
    impl.getPositionPaper,
    impl.getPositionByMarket,
    impl.readPosition,
    impl.readPositionPaper
  );

const upsertPosition =
  impl && pick(
    impl.upsertPosition,
    impl.upsertPositionPaper,
    impl.savePosition,
    impl.savePositionPaper,
    impl.writePosition,
    impl.writePositionPaper,
    impl.setPosition
  );

const listPositions =
  impl && pick(
    impl.listPositions,
    impl.listPositionsPaper,
    impl.getPositions,
    impl.getPositionsPaper
  );

async function _notReady(name) {
  throw new Error("positions storage not wired: " + name);
}

module.exports = {
  getPosition: getPosition || (async (...args) => _notReady("getPosition")),
  upsertPosition: upsertPosition || (async (...args) => _notReady("upsertPosition")),
  listPositions: listPositions || (async (...args) => _notReady("listPositions")),
};
