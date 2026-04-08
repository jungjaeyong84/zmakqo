const assert = require('assert');
const { buildFillDisplayReason } = require('../utils/fillReasonView');

(() => {
  const primary = buildFillDisplayReason({ event: 'LONG' });
  assert.strictEqual(primary.exec_text, '신규 진입 체결');
  assert.strictEqual(primary.exec_ko, '롱 진입이 실제 주문으로 체결됐습니다.');

  const entry = buildFillDisplayReason({ event: 'CORE_LONG' });
  assert.strictEqual(entry.exec_text, '신규 진입 체결');
  assert.strictEqual(entry.exec_ko, '롱 진입이 실제 주문으로 체결됐습니다.');

  const tp1 = buildFillDisplayReason({ event: 'EXIT_TP_P1_1.65P' });
  assert.strictEqual(tp1.exec_text, '1차 익절 체결');
  assert.strictEqual(tp1.exec_ko, '1차 익절 조건이 충족되어 부분 또는 전량 청산이 체결됐습니다.');

  const trail = buildFillDisplayReason({ event: 'EXIT_TRAIL' });
  assert.strictEqual(trail.exec_text, '트레일링 청산 체결');
  assert.strictEqual(trail.exec_ko, '트레일링 조건이 충족되어 잔여 물량 청산이 체결됐습니다.');

  console.log('FILL_DISPLAY_REASON_TEST_OK');
})();
