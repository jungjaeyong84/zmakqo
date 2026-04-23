# DONBEOLJA V2 Alert Retry Runbook

## 목적

이 문서는 `trade_alert_outbox_v2` 의 delivery / retry 실패를 운영자가 같은 분류 체계로 해석하도록 고정한다.

핵심은 "실패 문자열을 읽고 감으로 판단" 이 아니라,
`last_reason_family`, `retry_policy_code`, `runbook_refs` 로 같은 판단을 재현하는 것이다.

## Checklist

| Ref | 계열 | `retry_policy_code` | 의미 | 다음 행동 |
| --- | --- | --- | --- | --- |
| `ALERT_RBK_01` | `OPERATOR_CONFIG` | `ALERT_CFG_TERMINAL` | 채널 비활성, token/chat 설정 누락, 운영 설정 문제 | 설정 수정 전 retry 금지 |
| `ALERT_RBK_02` | `PAYLOAD` | `ALERT_PAYLOAD_TERMINAL` | prepared payload / delivery request / outbox 구조가 불완전 | payload 정본 복구 전 retry 금지 |
| `ALERT_RBK_03` | `POLICY` | `ALERT_POLICY_TERMINAL` | muted policy, 의도적 skip, 정책상 전송 금지 | 정책 변경 전 retry 금지 |
| `ALERT_RBK_04` | `TRANSPORT` | `ALERT_RETRY_TRANSPORT` | HTTP / Telegram / OpenClaw transport 실패 | cooldown 이후 bounded retry 허용 |
| `ALERT_RBK_05` | `RETRY_GOVERNANCE` | `ALERT_RETRY_GOVERNANCE` | cooldown active, max attempt 초과 | 즉시 재시도 금지, cadence/한도 재검토 |
| `ALERT_RBK_99` | `UNKNOWN` | `ALERT_POLICY_UNKNOWN` | 분류되지 않은 실패 | unknown taxonomy 추가 후 재평가 |

## Code Trace-Back

이 runbook은 아래 코드 정본을 기준으로 유지한다.

1. taxonomy 정본: `src/v2/alertFailureTaxonomy.js`
2. taxonomy contract catalog: `src/v2/alertFailureTaxonomy.js` 의 `ALERT_FAILURE_TAXONOMY_CONTRACTS`
3. delivery writer 정본: `src/v2/alertDeliveryWorker.js`
4. retry governance 정본: `src/v2/alertRetryWorker.js`
5. fail-closed 문서 검사: `scripts/check-v2-alert-runbook.js`

즉, `last_reason_family`, `retry_policy_code`, `runbook_refs` 는 문서가 아니라 코드에서 먼저 결정되고, runbook은 그 코드를 그대로 따라야 한다.

## Reverse Index

아래 표는 운영자가 failure string에서 바로 code path를 역추적할 때 쓰는 최소 인덱스다.

| reason 예시 | family | `retry_policy_code` | runbook ref | source |
| --- | --- | --- | --- | --- |
| `V2_SHADOW_ALERT_DELIVERY_DISABLED` | `OPERATOR_CONFIG` | `ALERT_CFG_TERMINAL` | `ALERT_RBK_01` | `src/v2/alertFailureTaxonomy.js` |
| `PREPARED_ALERT_NOT_DELIVERABLE` | `PAYLOAD` | `ALERT_PAYLOAD_TERMINAL` | `ALERT_RBK_02` | `src/v2/alertFailureTaxonomy.js` |
| `SKIP_ALERT` | `POLICY` | `ALERT_POLICY_TERMINAL` | `ALERT_RBK_03` | `src/v2/alertFailureTaxonomy.js` |
| `ALERT_DELIVERY_FAILED` | `TRANSPORT` | `ALERT_RETRY_TRANSPORT` | `ALERT_RBK_04` | `src/v2/alertFailureTaxonomy.js` |
| `RETRY_MAX_ATTEMPT_EXCEEDED`, `RETRY_COOLDOWN_ACTIVE` | `RETRY_GOVERNANCE` | `ALERT_RETRY_GOVERNANCE` | `ALERT_RBK_05` | `src/v2/alertRetryWorker.js` |
| 분류되지 않은 reason | `UNKNOWN` | `ALERT_POLICY_UNKNOWN` | `ALERT_RBK_99` | `src/v2/alertFailureTaxonomy.js` |

## 규칙

1. `last_reason_family=TRANSPORT` 인 경우에만 자동 retry 후보가 된다.
2. `last_reason_family=OPERATOR_CONFIG|PAYLOAD|POLICY` 는 terminal 로 본다.
3. `RETRY_MAX_ATTEMPT_EXCEEDED`, `RETRY_COOLDOWN_ACTIVE` 는 실패 원인이라기보다 governance 차단이다.
4. retry worker는 stored `delivery_request` 와 `prepared_payload` 만 사용한다.
5. retry 단계에서 제목/본문을 새로 만들면 안 된다.
6. runbook과 code가 drift 나면 `node scripts/check-v2-alert-runbook.js` 가 fail-closed 되어야 한다.
7. 신규 alert failure reason 계열을 추가할 때는 `ALERT_FAILURE_TAXONOMY_CONTRACTS`, 이 runbook 표, taxonomy 테스트를 같이 갱신해야 한다.
