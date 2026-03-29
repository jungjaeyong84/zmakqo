# AI Allocation Policy (Live)

## 개요
- GPT가 뉴스 기반으로 “시장 모드”를 결정합니다.
- 코인별 비중은 변동성(리스크) 기반으로 산출합니다.
- 실거래 자동 적용은 안전장치가 모두 만족될 때만 진행됩니다.

## 동작 순서
1) 뉴스 수집(최근 7일, 크립토 + 글로벌 금융)
2) GPT로 모드 결정: aggressive / neutral / conservative
3) 변동성 기반 비중 계산
4) 최대/최소 비중, 주간 변경폭 제한 적용
5) 조건 충족 시 risk_budget 자동 갱신

## 안전장치
- 코인별 최소/최대 비중
- 주간 변경폭 제한
- 실거래 모드 + live_enabled + live_confirm_required=false 필요
- GPT 실패 시 마지막 모드를 재사용 (없으면 neutral)

## 설정
```
GET  /api/settings/ai-allocation
POST /api/settings/ai-allocation
```

필수 환경변수:
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (기본: gpt-4o-mini)
- `NEWS_PROVIDER` (기본: gdelt, 무료/무키)
- `NEWS_API_KEY` (NEWS_PROVIDER=newsapi 일 때만 필요)

## 스케줄러
```
POST /scheduler/ai-allocation
```
body: `{ "dry_run": "1" }` 또는 생략
