# Codex Octopus V1

목표
- 메인 오케스트레이터는 Codex
- 서브 리뷰어는 Claude, Gemini
- 결과는 합의율과 Codex 최종 종합으로 정리

구성
1. 입력 task 저장
2. Claude 서브 실행
   - 우선 Anthropic API 사용
   - 키: `ANTHROPIC_API_KEY` 또는 `CLAUDE_API_KEY`
3. Gemini 서브 실행
   - 우선 Gemini API 사용
   - 키: `GEMINI_API_KEY` 또는 `GOOGLE_API_KEY`
4. Codex가 두 결과를 종합
5. `summary.json`, `summary.md` 생성
6. 필요 시 텔레그램 요약 전송

파일
- 설정: [/Users/jeongjaeyong/Projects/donbeolja/config/codex_octopus.json](/Users/jeongjaeyong/Projects/donbeolja/config/codex_octopus.json)
- 실행기: [/Users/jeongjaeyong/Projects/donbeolja/scripts/codex-octopus.js](/Users/jeongjaeyong/Projects/donbeolja/scripts/codex-octopus.js)
- Gemini 클라이언트: [/Users/jeongjaeyong/Projects/donbeolja/src/services/geminiClient.js](/Users/jeongjaeyong/Projects/donbeolja/src/services/geminiClient.js)
- 주간 연결: [/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-weekly-pine-upgrade.js](/Users/jeongjaeyong/Projects/donbeolja/scripts/automation-weekly-pine-upgrade.js)
- 출력: `ops/daily/octopus/<date>_<time>_<slug>/`

실행 예시
```bash
node scripts/codex-octopus.js \
  --workflow pine-upgrade \
  --title "15m 주간 Pine 검토" \
  --prompt-file ops/weekly_pine_upgrade_automation_prompt.md \
  --notify
```

현재 상태
1. Codex 메인 실행은 정상
2. Claude/Gemini는 API 키가 있으면 바로 활성
3. API 키가 없으면 `UNAVAILABLE (NO_API_KEY)`로 기록
4. 주간 Pine 업그레이드 자동화는 이제 Octopus를 호출함
5. Octopus가 미가용이면 주간 자동화는 기존 안전 후보 로직으로 fallback
