# Scheduler Env Policy

## 목적
자동 평가/스케줄러 환경값의 설정 오류를 조기에 감지한다.

## 실행 방식
- 수동 점검: `npm run check:scheduler-env`
- 서버 시작 시 자동 점검: `SCHEDULER_ENV_CHECK`로 제어

### SCHEDULER_ENV_CHECK
- `off`/`0` : 점검 비활성(기본)
- `warn`    : 결과 출력, 오류가 있어도 실행 계속
- `error`/`1`/`strict` : 오류가 있으면 서버 시작 중단

## ERROR (실행 중단 권장)
- 자동 평가/주간 마감이 ON인데 `SCHEDULER_TOKEN` 없음
- `BASE_URL`이 비어있거나 http(s)가 아님
- 프로덕션에서 `BASE_URL`이 localhost

## WARN (실행 허용, 기록 필요)
- `AUTO_EVAL_LATEST_CHECK_MS` < 1시간
- `AUTO_EVAL_LATEST_MAX_AGE_MS` < `AUTO_EVAL_LATEST_CHECK_MS`
- `SCHEDULER_POLL_MS` < 60초
- 주간 마감 윈도우 범위가 역전됨

## 권장 기본값
- `AUTO_EVAL_LATEST_CHECK_MS = 6h`
- `AUTO_EVAL_LATEST_MAX_AGE_MS = 24h`
- `SCHEDULER_POLL_MS = 5m`
- `SCHEDULER_GRACE_MS = 15s`
