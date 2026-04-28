# Stage U-followup — V2 Ownership Design (2026-04-29)

> Stage T/U-1/U-2/U-3 가 V1 path 를 모두 차단했다. operator 의도
> ("V1 자체가 작동하면 안 되고 V2 가 모든 처리를 인계받아야 한다") 의
> 후반부 — V2 의 ownership — 는 **코드 부재**. 이 문서는 V2 가 인계받아야
> 할 항목 + 각 항목의 implementation scope + 우선순위 + risk 정리.

---

## 1. 현재 상태 (post Stage U-3)

### V1 차단 완료

| Path | 차단 layer | log marker |
|---|---|---|
| webhook → runOneMarket (V1 entry) | `marketRunner.runOneMarket` early return | `v1_market_runner_skipped_legacy_runtime_disabled` |
| scheduler → runOneMarket (V1 entry) | 동일 | 동일 |
| V1 V2-discovery loop EXIT_OPPOSITE_SIGNAL inject | `paperBinanceRunner.js` line 18380 부근 | `v1_exit_opposite_inject_skipped_v2_legacy_disabled` |
| binanceTickExit V1 fast-lane (runPaperMarket EXIT_ONLY) | `binanceTickExit.js` line 3454 부근 | `v1_tick_exit_fast_lane_skipped_legacy_runtime_disabled` |
| systemAnomalyRemediation V1 flatten | `systemAnomalyRemediation.js` 진입 직후 | `v1_system_anomaly_remediation_skipped_legacy_runtime_disabled` |
| trading.actions /api/trading/manual-retry-entry | handler 진입 첫 줄 | `v1_manual_retry_entry_blocked_legacy_runtime_disabled` |

### 단독 자동 청산 채널 (현재)

```
└─ broker-side native protection (closePosition STOP_MARKET)
   └─ binanceTickExit.refreshBinanceTickExitNativeProtection
      └─ placeFuturesStopMarketOrder + cancelFuturesOpenOrders 직접 호출
         (V1 paperBinanceRunner 무관)
```

### 단독 의존 risk

- native protection refresh fail (e.g. EGRESS_PROXY_TIMEOUT) 시 stale stop
- TP1/SL/TRAIL trigger 가 거래소 측 STOP_MARKET 에만 반영
- refresh 실패 + 가격 movement = unbounded loss
- anomaly (circuit breaker open) 시 자동 flatten 손실 — operator 수동 개입 필요

---

## 2. V2 가 인계받아야 할 항목

### 2-A. Emit-driven exit (P1, 가장 큰 hole)

**현재**: V1 fast-lane (TP1/SL/TRAIL trigger 검출 → V1 EXIT signal generation
→ V1 executor 거래소 close) 가 차단됨. 거래소 측 STOP_MARKET 단독 의존.

**V2 ownership 구조**:
- option A: binanceTickExit 가 fast-lane skip 시 **직접 placeFuturesMarketOrder(reduceOnly=true)** 호출
  - V2 path 도 아니고 V1 path 도 아님 — binanceTickExit 자체 owning
  - 가장 단순 (refreshBinanceTickExitNativeProtection 와 동일 패턴)
  - 단점: V2 router (signalAuthorityRouter) 의 결정 layer 우회
- option B: V2 의 새 component `v2/exitRouter.js` 가 emit-driven exit 처리
  - signalAuthorityRouter 와 비슷하게 reverse signal 받아 V2 exit dispatch
  - V2 의 risk gate 적용 가능 (e.g. exit cooldown)
  - 큰 작업 (~500-1000 LOC)
- option C: 그냥 native STOP refresh 강화 (현재 retry 늘리기, alert escalation)
  - V2 ownership 안 늘리고 fail mode 처리만
  - implementation 가벼움
  - operator 의도 ("V2 가 모두") 와 부분 일치만

**senior 권장**: option A (binanceTickExit 자체 ownership). V1/V2 분리 없이 simple. 거래소 직접 호출.

**implementation 추정**: 200-400 LOC, 3-5 unit test, 1 deploy.

### 2-B. V2 anomaly worker (P1)

**현재**: systemAnomalyRemediation V1 flatten 차단. anomaly 시 operator 수동 청산 only.

**V2 ownership 구조**:
- 새 component `src/v2/anomalyWorker.js`
- breaker open detect → 모든 active position 에 대해 placeFuturesMarketOrder(reduceOnly=true)
- V1 path 우회, V2 의 audit trail (canonical_exit_reducer) 통과
- 또는 binanceTickExit 가 anomaly 감지 + 직접 close (option A 와 비슷)

**implementation 추정**: 300-500 LOC, 5-7 test.

### 2-C. V2 manual-retry endpoint (P2)

**현재**: /api/trading/manual-retry-entry 503 응답. operator 가 거래소 UI 사용.

**V2 ownership 구조**:
- 새 endpoint `POST /api/v2/manual-retry-entry`
- V2 router (productionEntryRoute) 호출 — V2 의 evidence chain 통과
- operator UI 가 새 endpoint 로 routing

**implementation 추정**: 100-200 LOC. 가장 가벼움.

### 2-D. Reverse signal auto-close (P2)

**현재**: V1 EXIT_OPPOSITE_SIGNAL inject 차단. 반대 신호 시 청산 안 됨 (현재 사용자 의도와 일치 — operator 가 "의도된 방향이야 놔둬").

**V2 ownership 구조**:
- V2 productionEntryRoute 가 reverse signal 받으면:
  - option A: 그냥 무시 (현재 동작)
  - option B: 자동 close + reverse entry (V1 inject 와 동등)
  - option C: alert 만 (operator 결정)
- operator policy 결정 필요

**implementation 추정**: option C 가장 단순 (50 LOC + alert wiring).

---

## 3. 우선순위 + 권장 sequence

| 순위 | 항목 | 이유 |
|---|---|---|
| **1** | **option A: binanceTickExit fast-lane → 직접 reduceOnly market** | native STOP refresh fail 시 backup. risk 즉시 해소. 단순 implementation. |
| **2** | V2 anomaly worker (option A 패턴) | breaker 시 자동 flatten 복원 |
| 3 | V2 manual-retry endpoint | operator workflow. P2 |
| 4 | Reverse signal policy | operator 결정 needed |

---

## 4. 단계별 risk

### Stage U-followup-1 (option A: tickExit 직접 reduceOnly)

**risk**:
- placeFuturesMarketOrder 호출 시 race condition 가능 (binanceTickExit 의 native protection refresh 와 동시 발생)
- reduceOnly=true 라 over-close 는 안 됨 (Binance dedup), 그러나 부분 close 시 잔량 처리 logic 필요

**mitigation**:
- 같은 lease (`runWithBinanceTickExitLease`) 안에서 호출
- order placement 후 native protection refresh 로 stop 갱신 (이미 패턴 존재)

### Stage U-followup-2 (V2 anomaly worker)

**risk**:
- breaker open 시점에 거래소 연결 자체 fail 가능 (anomaly 의 정의 = 시스템 이상)
- 그 시점에 placeFuturesMarketOrder 도 fail → 청산 안 됨

**mitigation**:
- multi-attempt + alert escalation
- operator 자동 SMS/Telegram 알림 (이미 trade-execution-alert 패턴 있음)

---

## 5. 자백

- 이 문서는 **design 문서**. implementation 0.
- option A/B/C 선택은 operator 결정.
- V2 ownership 후반부 (전부 V2 path) 는 큰 작업 — 1주일+ 분량.
- 현재 운영은 native STOP refresh 가 robust 한 동안 안전. fail 빈도 모니터링 필요.

---

## 6. 다음 step 권장

1. **24h prod monitoring** — Stage U fix 후 native STOP refresh fail 빈도, drop alert 0 유지, anomaly 발생 빈도
2. **operator 결정** — Stage U-followup-1 (option A) 진행 vs 현 상태 유지
3. **Codex 5.5 외부 review** — 이 문서 + 오늘 fix 들 외부 검증
4. **그 후 implementation** 결정
