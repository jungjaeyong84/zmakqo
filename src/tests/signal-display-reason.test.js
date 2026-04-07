const assert = require('assert');
const { buildSignalDisplayReason, classifySignalReasonStage } = require('../utils/signalReasonView');

(() => {
  const failed = buildSignalDisplayReason(
    { reason: 'PINE_DROP_STALE_POS_TO_ENTRY' },
    {
      status: 'FAILED_INTERNAL',
      status_family: 'CANCELED',
      pending_reason: 'EXEC_CURRENT_BAR',
      status_reason: 'LIVE_FAILED',
      cancel_reason: 'MARGIN_TYPE_SET_FAILED',
      cancel_note: 'margin change rejected',
      last_error: 'No need to change margin type.',
    }
  );
  assert.strictEqual(failed.primary, 'MARGIN_TYPE_SET_FAILED');
  assert.strictEqual(failed.detail, 'No need to change margin type.');
  assert.strictEqual(failed.secondary, 'PINE_DROP_STALE_POS_TO_ENTRY');

  const external = buildSignalDisplayReason(
    { reason: 'TV_WEBHOOK' },
    {
      status: 'FILLED',
      status_reason: 'EXTERNAL_FILL_RECONCILED',
    }
  );
  assert.strictEqual(external.primary, 'EXTERNAL_FILL_RECONCILED');
  assert.strictEqual(external.is_external_fill, true);
  assert.strictEqual(external.stage_key, 'FILLED');
  assert.strictEqual(external.stage_text, '체결 완료');

  const filled = buildSignalDisplayReason(
    { reason: 'TV_WEBHOOK' },
    {
      status: 'FILLED',
      status_reason: 'FILLED',
    }
  );
  assert.strictEqual(filled.primary, 'FILLED');
  assert.strictEqual(filled.stage_key, 'FILLED');
  assert.strictEqual(filled.stage_text, '체결 완료');
  assert.strictEqual(filled.reason_ko, '진입 조건을 통과한 주문이 실제로 체결됐습니다.');

  const pending = buildSignalDisplayReason(
    { reason: 'TV_WEBHOOK' },
    {
      status: 'PENDING',
      pending_reason: 'EXEC_CURRENT_BAR',
    }
  );
  assert.strictEqual(pending.primary, 'EXEC_CURRENT_BAR');
  assert.strictEqual(pending.detail, null);

  const stageQuality = classifySignalReasonStage('DROP_ENTRY_QUALITY_CONF');
  assert.strictEqual(stageQuality.step, 1);
  assert.strictEqual(stageQuality.text, '1차 상태/무결성');

  const stagePine = classifySignalReasonStage('DROP_PINE_STAGE1_QUALITY_REJECT');
  assert.strictEqual(stagePine.key, 'PINE');
  assert.strictEqual(stagePine.text, 'Pine 품질 필터');

  const stageAi = classifySignalReasonStage('DROP_AI_BIAS_OPPOSITE_LONG');
  assert.strictEqual(stageAi.step, 3);
  assert.strictEqual(stageAi.text, '3차 상태 기반 Soft Sizing');

  const stageAiMissing = classifySignalReasonStage('DROP_AI_MISSING');
  assert.strictEqual(stageAiMissing.step, 2);
  assert.strictEqual(stageAiMissing.text, '2차 진입 품질');

  const stageEv = classifySignalReasonStage('DROP_EV_GATE_TP1_PROB');
  assert.strictEqual(stageEv.step, 4);
  assert.strictEqual(stageEv.text, '4차 EV/시간가치층');

  const stageMarket = classifySignalReasonStage('DROP_LONG_GATE_CONF');
  assert.strictEqual(stageMarket.step, 1);
  assert.strictEqual(stageMarket.text, '1차 상태/무결성');

  const marketReason = buildSignalDisplayReason(
    { reason: 'DROP_LONG_GATE_CONF' },
    {}
  );
  assert.strictEqual(marketReason.reason_ko, 'Pine 품질 번들을 바로 신뢰하지 못해 서버 fallback 무결성 검사를 진행했고, 롱 방향 confidence 값이 기준보다 낮아 진입을 보류했습니다.');

  const pineReason = buildSignalDisplayReason(
    { reason: 'DROP_PINE_STAGE1_QUALITY_REJECT' },
    {}
  );
  assert.strictEqual(pineReason.reason_ko, 'Pine 품질 번들에서 이미 기준 미달로 판단된 신호라 서버가 ENTRY로 되살리지 않았습니다.');

  const evReason = buildSignalDisplayReason(
    { reason: 'DROP_EV_GATE_TP1_PROB' },
    {}
  );
  assert.strictEqual(evReason.reason_ko, 'TP0/TP1/시간청산을 함께 반영한 기대값 하한이 기준보다 낮아 진입을 보류했습니다.');

  const waitStage = classifySignalReasonStage('DROP_WAIT_ONE_BAR_TIMING');
  assert.strictEqual(waitStage.step, 5);
  assert.strictEqual(waitStage.key, 'TIMING');
  assert.strictEqual(waitStage.text, '5차 WAIT 타이밍층');

  const waitReason = buildSignalDisplayReason(
    { reason: 'DROP_WAIT_ONE_BAR_TIMING' },
    {}
  );
  assert.strictEqual(waitReason.reason_ko, '현재 봉이 과열된 추격봉으로 보여 다음 봉까지 진입을 연기했습니다.');

  const chaseStage = classifySignalReasonStage('DROP_CHASE_ENTRY_QUALITY');
  assert.strictEqual(chaseStage.step, 5);
  assert.strictEqual(chaseStage.key, 'TIMING');

  const chaseReason = buildSignalDisplayReason(
    { reason: 'DROP_CHASE_ENTRY_QUALITY' },
    {}
  );
  assert.strictEqual(chaseReason.reason_ko, '최근 봉이 과확장 추격 구간으로 판단되어 진입을 보류했습니다.');

  const rescueAddBlocked = buildSignalDisplayReason(
    { reason: 'LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED' },
    {}
  );
  assert.strictEqual(rescueAddBlocked.stage_key, 'OPS');
  assert.strictEqual(rescueAddBlocked.reason_ko, '현재 손실 폭이 구조보강 ADD 허용 구간 밖이라 추가 진입을 보류했습니다.');

  console.log('SIGNAL_DISPLAY_REASON_TEST_OK');
})();
