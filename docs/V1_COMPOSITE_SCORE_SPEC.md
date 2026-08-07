# v1 복합 점수 엔진 — 원본 사양

출처: `code/donbeolja_v5.5.9.1.pine.txt` (STRATEGY_ID `donbeolja_v5.5.9.1`)
추출: 2026-08-08

이 문서는 사용자가 v1에서 운영했던 **전통 지표 복합 판단 엔진**을 Pine 원본에서 그대로 옮긴 것이다.
2026-08-08의 v5 복합 연구(`analyze-v5-all-indicators.js`)는 **이 구조를 검정하지 않았다.** 그 이유는
아래 "왜 v5 분석이 이걸 놓쳤는가"에 정리한다.

---

## 1. 점수 합성 (Pine 1379~1395행)

6개 조건의 **가중 불리언 투표**. 롱/숏 완전 대칭.

```
raw_long  += bull_trend  ? w_trend  : 0
raw_long  += bull_htf    ? w_htf    : 0
raw_long  += bull_td     ? w_td     : 0
raw_long  += bull_stoch  ? w_stoch  : 0
raw_long  += bull_vol    ? w_vol    : 0
raw_long  += bull_regime ? w_regime : 0
raw_short += (같은 구조, bear_* 조건)

total_weight   = w_trend + w_htf + w_td + w_stoch + w_vol + w_regime   // 4.9
score_abs_long  = raw_long  / total_weight * 100
score_abs_short = raw_short / total_weight * 100
score_raw       = score_abs_long - score_abs_short                      // -100 ~ +100
```

| 성분 | 가중치 | 비중 |
|---|---|---|
| Trend | 1.0 | 20.4% |
| HTF RSI | 1.0 | 20.4% |
| Volume | 0.8 | 16.3% |
| TD Sequential | 0.7 | 14.3% |
| Stochastic | 0.7 | 14.3% |
| Regime (ADX/DMI) | 0.7 | 14.3% |
| **합계** | **4.9** | 100% |

---

## 2. 6개 조건의 정확한 정의

### trend (1.0) — Pine 1062~1073
```
trend_src  = trend_basis=="고저종/3" ? (H+L+C)/3 : close
trend_fast = EMA(trend_src, trend_len_fast)
trend_slow = EMA(trend_src, trend_len_slow)
trend_bull = trend_fast > trend_slow
up_score   = 최근 trend_strong_bars 동안 trend_bull 이었던 봉 수
trend_state = "bull"  if up_score   >= trend_strong_bars * 0.7
              "bear"  if down_score >= trend_strong_bars * 0.7
              "neutral" 그 외
```
**핵심**: 순간 크로스가 아니라 **최근 N봉 중 70% 이상 유지**해야 성립. 지속성 요구.

### htf (1.0) — Pine 1083~1091
```
htf_rsi = RSI(상위 TF 종가, htf_len)
htf_state = "bull"    if htf_rsi >= htf_rsi_bull_min
            "bear"    if htf_rsi <= htf_rsi_bear_max
            "neutral" 그 외
```
**핵심**: 중간에 **중립 데드밴드**가 있음. 양쪽 다 성립 안 하는 구간 존재.

### td (0.7) — Pine 1099~1109
```
td_up   = close > close[4]
td_down = close < close[4]
td_buy  = td_up   ? td_buy[1]+1  : 0     // 연속 카운트
td_sell = td_down ? td_sell[1]+1 : 0
td_state = "buy"  if td_buy > 0  and td_sell == 0
           "sell" if td_sell > 0 and td_buy == 0
```
TD Sequential. 4봉 전 종가 대비 연속성.

### stoch (0.7) — Pine 1305
```
k_raw = stoch(H,L,C, stoch_k_len)
k_val = SMA(k_raw, stoch_smooth)
d_val = SMA(k_val, stoch_d_len)
bull_stoch = k_val > d_val and k_val < 80
bear_stoch = k_val < d_val and k_val > 20   (대칭)
```
**핵심**: **비단조 복합 조건.** "상승 중이되 과매수는 아님". k의 원시값에 대해 단조가 아니다.

### vol (0.8) — Pine 1203~1204, 1307~1309
```
vol_ratio  = volume / SMA(volume, vol_ma_len)
vol_ultra  = vol_ratio >= vol_ultra_thr
vol_strong = not vol_ultra and vol_ratio >= vol_strong_thr
vol_bull_bias = close >= bw_mid or bull_trend
bull_vol = (vol_ultra or vol_strong) and vol_bull_bias
```
**핵심**: 거래량 **강도 AND 방향 편향**의 논리곱.

### regime (0.7) — Pine 1216~1234, 1311
```
pDI, mDI, adx_val = 표준 Wilder ADX/DMI(adx_len)
regime_state = "range"      if adx_val < adx_side_thr
               "trend"      if adx_val > adx_trend_thr
               "transition" 그 외
bull_regime = regime_state == "trend" and pDI >= mDI
```
**핵심**: **추세 강도 AND 방향**의 논리곱. ADX 단독이 아님.

---

## 3. 점수 위에 얹힌 층

### 단계 게이트 (Pine 507~530)
```
score_early_abs = (strict ? 24 : 18) * relax
score_core_abs  = (strict ? 34 : 28) * relax
score_pre_abs   = (strict ? 40 : 34) * relax
score_real_abs  = (strict ? 46 : 40) * relax
score_ok = is_long ? (score >= thr) : (score <= -thr)
```
EARLY → CORE → PRE_REAL → REAL 로 갈수록 |score| 요구치 상승. 신호 등급제.

### 통합 신뢰도 (Pine 542)
```
conf_local = 0.4*score_conf + 0.4*posterior_conf + 0.2*ev_conf
score_conf = clamp01(|score| / 100)
```

### 동적 백분위 게이트 (Pine 548~558)
```
score_abs_rank = percentrank(|score|, dyn_len)
dyn_ok = score_abs_rank >= dyn_rank_thr
         and wave_conf_rank >= dyn_rank_thr
         and post_spread_rank >= dyn_rank_thr
         and ev_rank >= dyn_rank_thr
```
절대 임계값이 아니라 **자기 이력 대비 백분위**로도 걸러냄.

### 그 외
- 세션 디버프: 코인 야간(KST 18~09) `score *= (1 - night_scale)`, 변동성 높으면 1.6배 가중
- Breakwater 패널티: 밴드 위치에 따라 score 감쇠 (0.70 / 0.50)
- 15m 이중 확증: 1H 신호는 15m EMA 방향 일치 요구 (`ltf_gate_long/short`)
- 바이낸스 선물 전용 최소 점수: CORE 25 / REAL 30 / PRE_REAL 18

---

## 4. 왜 2026-08-08의 v5 분석이 이걸 놓쳤는가

`analyze-v5-all-indicators.js`는 지표 **원시값의 z점수를 평균**하고 Spearman IC로 평가했다.
그 방법은 아래 비선형을 **구조적으로 탐지할 수 없다**:

1. **비단조 조건** — `k<80`(과매수 아님)은 k 원시값에 대해 단조가 아니다. 선형 상관은 0에 가깝게 나온다.
2. **논리곱** — `강한 거래량 AND 상방 편향`은 두 변수를 따로 z점수 내면 사라진다.
3. **지속성 요구** — `최근 N봉 중 70% 이상`은 순간값에 없다.
4. **중립 데드밴드** — htf_state가 중립인 구간은 투표에서 빠지는데, z점수는 그 구간에도 값을 준다.
5. **불리언 합류 개수** — "몇 개가 동의하는가"는 값의 평균과 다른 통계량이다.
6. **단계 게이트** — |score| 임계값이 신호를 등급화하는데, IC는 전 구간을 동일 취급한다.
7. **다중 시간프레임** — HTF RSI, 15m 확증 게이트.

즉 2026-08-08 결론("고전 지표의 정보는 전부 시장 타이밍이고 횡단면 IC는 0")은
**선형 z점수 복합에 대해서만 성립한다.** v1의 불리언 합류 구조에 대해서는 아직 아무것도 측정하지 않았다.

---

## 5. 다음 단계

이 사양을 그대로 JS로 옮겨 동일한 정직성 절차로 검정한다:
- 심볼 디민 IC + **원시/횡단면 대조** (2026-08-08에 발견한 필수 대조)
- 인샘플 파라미터 확정 → 아웃샘플 평가
- **포트폴리오 단위 비중첩 검정** (개별 관측은 t를 11~104배 부풀림)
- 비용 부과, 롱숏 대칭 유지

파라미터 기본값은 `config/runtime_config.json`과 Pine `input.*` 기본값에서 가져온다.
