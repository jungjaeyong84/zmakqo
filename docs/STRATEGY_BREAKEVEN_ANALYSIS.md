# Strategy Breakeven Analysis (2026-04-28)

> 외부 시니어 review 가 가장 먼저 잡을 항목 — TP1 0.025 / SL 0.0165 의
> breakeven win rate 가 정확히 얼마인가, owner 의 "+0.43% / trade @
> 50% win" 주장이 fee/slippage 포함 시 어떻게 변하는가. **백테스트
> 데이터 0** 인 상태에서 mathematical reasoning 만으로 도달 가능한
> 한계까지 정직히 분석.

---

## 0. 입력 (현재 production 설정, src/engine/signalEngine.js)

```
SL              = -0.0165   (1.65% loss on equity, leverage-normalized)
TP_P1           = +0.025    (2.5% gain on equity, leverage-normalized)
TP_P1_QTY       = 0.5       (TP1 시 50% close, 50% runner 잔존)
RUNNER_MIN_PROFIT_PCT = 0.02 (runner 최소 보장 +2%)
TRAIL_R_MULTIPLE = 0.9      (peak 부터 0.9R 후퇴 시 trail SL)
BE_PCT          = 0.0025    (0.25% BE buffer)
leverageEff     = 2         (futures 2x)
```

수치는 모두 **PnL on equity** (이미 leverage 적용). 실제 가격 move 는
이 값 / 2.

---

## 1. 비용 모델 (Binance Futures, conservative)

| 항목 | 값 (round-trip, on equity at 2x leverage) |
|---|---|
| Taker fee × 2 sides | 0.04% × 2 × leverage_eff(2x) = **0.16%** |
| Slippage × 2 sides | 1bp × 2 × leverage_eff(2x) = **0.04%** |
| Funding (15-min hold, 0.01%/8h) | 0.01% / 32 ≈ **0.0003%** (무시 가능) |
| **총 round-trip cost on equity** | **~0.20%** |

> Binance VIP 0 기준. maker order 는 0.02% 라 fee 절반이지만,
> 시스템이 maker-first 옵션은 ENTRY only 라 EXIT (taker market) 가
> 항상 0.04%. 보수적으로 둘 다 taker 가정.

---

## 2. 단일 round-trip 결과 분류

### 2-A. Loss (SL 먼저 hit)
```
Equity PnL = SL - cost = -1.65% - 0.20% = -1.85%
```

### 2-B. Win (TP1 hit + runner 처분)

TP1 시 50% close, 50% runner. Runner 의 4 가지 분기:

| 분기 | Runner 결과 | 빈도 (가정) | 풀 PnL |
|---|---|---|---|
| W1: 즉시 BE 후퇴 | runner +0.25% | 30% | 0.5 × 2.5 + 0.5 × 0.25 - cost = **1.18%** |
| W2: RUNNER_MIN_PROFIT 도달 | runner +2.00% | 50% | 0.5 × 2.5 + 0.5 × 2.0 - cost = **2.05%** |
| W3: 추가 trail 확장 | runner +5.0% | 15% | 0.5 × 2.5 + 0.5 × 5.0 - cost = **3.55%** |
| W4: 큰 trail 확장 | runner +10.0% | 5% | 0.5 × 2.5 + 0.5 × 10 - cost = **6.05%** |

**평균 win (가정 빈도):**
```
avg_win = 0.30 × 1.18 + 0.50 × 2.05 + 0.15 × 3.55 + 0.05 × 6.05
        = 0.354 + 1.025 + 0.5325 + 0.3025
        = 2.21% (net)
```

> ⚠️ runner 빈도 분포는 **순수 추정**. 백테스트 데이터 없음.

---

## 3. Breakeven win rate

```
Expected_value(p) = p × avg_win + (1 - p) × avg_loss
                  = p × 2.21 + (1 - p) × (-1.85)
                  = 4.06p - 1.85
```

`E(p) = 0` → **p = 1.85 / 4.06 = 0.4557 = 45.6%**

---

## 4. Sensitivity table

| Win rate | Expectancy / trade (net of costs) |
|---|---|
| 35% | **-0.62%** (대량 손실) |
| 40% | **-0.23%** |
| **45.6%** | **0% (breakeven)** |
| 50% | +0.18% |
| 55% | +0.38% |
| 60% | +0.59% |
| 65% | +0.79% |
| 70% | +1.00% |

---

## 5. Owner 주장 검증 (2026-04-28 V2_KNOWN_LIMITS §2)

> "win rate 50% 가정 하 expectancy +0.43% / trade"

### 검증

Owner 의 +0.43% 는 **단순 two-outcome (TP1 = full close, no runner)
+ 비용 0** 가정:
```
0.5 × 2.5% + 0.5 × (-1.65%) = +0.425% / trade
```

이 모델의 결함:
1. **fee + slippage 0** — 실제 round-trip cost ~0.20% 누락
2. **runner 무시** — TP1_QTY=0.5 인데 모든 win 을 TP1=2.5% 로 처리.
   실제로는 50% 만 TP1 에서 closed, 50% runner 추가 변동.
3. **runner 분포 추정 없음** — 위 §2-B 의 W1-W4 빈도가 통계 근거 0.

### 정정

cost 만 반영, runner 무시한 단순 모델 (owner 의 가정 하에서):
```
avg_win  = 2.5 - 0.2 = 2.30
avg_loss = -1.65 - 0.2 = -1.85
breakeven_p = 1.85 / (2.30 + 1.85) = 0.446 = 44.6%
expectancy(p=50%) = 0.5 × 2.30 + 0.5 × (-1.85) = +0.225%
```

**owner 의 +0.43% → 실제 +0.23% (cost 반영)**. 50% 로 줄어듦.

§2 의 4-outcome runner 모델로 재계산 시 expectancy(50%) = +0.18%
~ +0.38% 사이 (runner 분포 가정에 따라).

---

## 6. Pine 신호의 win rate 가 45.6% 이상이라는 증거?

**없음**. Pine script (`donbeolja_v6.0.3.3.pine.txt`) 는 별도 repo
이고 historical performance data 가 검증되지 않음. 시스템이 의존하는
유일한 alpha source 가 통계적으로 검증 안 된 상태.

이게 **시스템 가장 큰 단일 약점** — Tier 3 으로 가려면 Pine script
walk-forward 6+ 개월 결과가 필수.

---

## 7. 운영 의미

### 시나리오 A: Pine 신호 win rate = 50% 인 경우

- Expectancy: +0.18% ~ +0.38% / trade (runner 분포 의존)
- 일 평균 trade ~3 (8 symbols × 추측), 월 60 trade
- 월 expected return on equity: 60 × 0.28% = **+16.8%** (매우 낙관)
- 그러나 sample size 60 의 standard error 는 크다. ±2σ band 는
  ±1% 에 가까울 수 있음 → 한 달 -16% 하락도 99% confidence interval
  안에 있음.

### 시나리오 B: Pine 신호 win rate = 42% (slightly below breakeven)

- Expectancy: -0.10% / trade
- 월 60 trade: -6% drawdown
- 누적 손실 가속

### 시나리오 C: Pine 신호 win rate = 38%

- Expectancy: -0.46% / trade
- 월 60 trade: -27.6% drawdown
- 강제 청산 risk

### 결론

**45.6% 는 좁은 마진**. Pine 신호 win rate 가 5%p 변동 (45 ↔ 50%) 에
따라 monthly P&L 이 -6% ↔ +17% 사이 swing.

---

## 8. Action items (외부 review 전)

1. **Pine script 의 historical win rate 추정 데이터 1개라도 확보** —
   TradingView Strategy Tester 의 6-month + 1-year backtest 결과 캡처
2. **현재 production 의 실제 win rate** — 지난 30 days 의 fills_paper
   집계로 산출 가능. canary entries 만이라도.
3. **Daily loss halt** — 시스템에 daily DD threshold 가 있어야. 현재
   `DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE=10` 만 있고
   live trading 에는 없음.
4. **Cost reduction 검토** — maker-first ENTRY 이미 활성. EXIT 도
   stop-limit 으로 maker 화 가능한지? (단점: stop 이 not-filled 시
   slippage > taker fee)

## 9. 자백

- runner 분포 (W1-W4 빈도) 는 **추정**. backtest 데이터 0.
- Funding 실제로 BTC perp 평균 0.01%/8h 이지만 ETH/XRP/SOL 등은 0.02
  ~0.05% 도 흔함. 보수적 추정 보다 더 비쌀 수 있음.
- Slippage 1bp 는 BTCUSDT 같은 깊은 시장 가정. AXSUSDT/DOGEUSDT 등
  thin 시장은 5bp+ 가능 → 8 symbols 평균 계산 시 cost ~0.30% 까지
  올라갈 수 있음.
- 위 모든 가정이 "actual win rate = 45.6% 에서 breakeven" 결론을
  얼만큼 흔드는지 정확히 보려면 결국 backtest 또는 30+ live trades
  데이터 필요.
- **점수 안 부른다** (약속).
