# Patch Proposal 2025W52

Generated at: 2025-12-27T14:19:16.832Z

## Summary
- Candidates: 1
- Range: 2025-12-26T14:19:14Z ~ 2025-12-27T14:19:14Z

---
## T5

**Hypothesis**

관측된 fill이 SELL로만 구성되어 진입/청산 흐름이 편향되었을 가능성이 있다.

**Evidence**
```json
{
  "fills_len": 1,
  "sides": [
    "SELL"
  ],
  "range": {
    "from": "2025-12-26T14:19:14Z",
    "to": "2025-12-27T14:19:14Z",
    "from_ms": 1766758754000,
    "to_ms": 1766845154000
  }
}
```

**Proposed Patch**

- src/paper/engine + signals pipeline (ENTRY 기록/의도 생성 여부 확인)

**Rollback Condition**

- 주간 팩에서 BUY/SELL 양쪽 관측 또는 fills_len=0

