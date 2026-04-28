# V2 Server-Native ENTRY Signal Generator — Pine v6.1.1.0 Parity Port

**작성**: 2026-04-28
**근거**: 사용자 결정 F2 (V2 자체 ENTRY signal generate path 신규 구현, parity 우선)
**소스 strategy**: `code/donbeolja_v6.1.1.0_PRODUCTION_CANDIDATE.pine.txt` (392 lines)
**스코프**: TV pine v6.1.1.0 의 ENTRY 신호 생성 로직을 server-native (Node.js) 로 1:1 포팅

---

## 0. 배경 (간단히)

V2 cutover (`DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL=1`) 후 TV webhook ENTRY 신호가
모두 차단되었으나 V2 자체 ENTRY 생성 path 가 코드베이스에 부재 → 거래 0.
이 문서는 그 gap 을 해소하기 위한 V2 server-native ENTRY generator 의 설계.

`signalEngine.generateSignals` (V1 EXIT-only) 와 직교 — 새 generator 는 ENTRY 만 만들고,
EXIT 은 기존 V1 logic 이 owning.

---

## 1. Pine v6.1.1.0 의 ENTRY 4가지 emit 조건

**최종 발화는 항상 다음 4가지 중 하나** (alert.freq_once_per_bar_close):

| 조건 | 사용 trigger | opportunity threshold | 추가 게이트 |
|---|---|---|---|
| `LONG CORE`  | continuation OR breakout | `>= 0.68` (`thr_core`) | `risk_ok_long_core`(htf 비충돌+rr+nochaos+nodead+nonext) AND `structure_alignment_long >= 0.62` AND `participation >= 0.42` AND `transition_core_quality_long` |
| `LONG EARLY` | reclaim OR breakout      | `>= 0.56` (`thr_early`) | `risk_ok_long_early`(rr+nodead+nochaos+nonext) AND `structure_alignment_long >= 0.40` AND `directional_pressure_long >= 0.42` AND `anti_chop_gate` |
| `SHORT CORE` | continuation OR breakdown | `>= 0.68` | 대칭 (단, `risk_ok_short_core` 는 `htf_conflict_short = htf_bias=="BULL"` 도 검사) |
| `SHORT EARLY`| loss OR breakdown        | `>= 0.56` | 대칭 |

**Cooldown** (line 227-228):
- `same_dir_cooldown_bars = 8` 기본값
- `long_can_fire = bar_index - last_long_signal_bar > 8` OR `trigger_type 변경`
- `last_long_signal_bar` 는 pine state 변수 → server-side 에서 Firestore 로 보존

**emit 우선순위** (line 230-233):
- `core_pulse = core_raw AND can_fire`
- `early_pulse = early_raw AND NOT core_pulse AND can_fire` (CORE 가 발화하면 EARLY 는 동일 bar 에 emit 안 함)

---

## 2. 필요한 Indicators (모두 표준 TA)

### Same-TF (entry timeframe — production: 1m/5m/15m 중 exec_tf)

```
ema_fast    = EMA(close, 8)
ema_mid     = EMA(close, 21)
ema_slow    = EMA(close, 55)
ema_anchor  = EMA(close, 144)

slope_fast  = ema_fast - ema_fast[5]    // 5 bars ago
slope_mid   = ema_mid  - ema_mid[5]
trend_strength_raw = abs((ema_fast - ema_slow) / ema_slow) * 100

rsi_val     = RSI(close, 14)
[macd_line, macd_signal, macd_hist] = MACD(close, 12, 26, 9)
atr         = ATR(14)
atr_ratio   = atr / close

vol_ma      = SMA(volume, 20)
vol_ratio   = volume / vol_ma           // safeguard for vol_ma==0

range_high  = highest(high, 20)
range_low   = lowest(low, 20)
range_span  = max(range_high - range_low, mintick)
price_position = clamp01((close - range_low) / range_span)

bar_range          = max(high - low, mintick)
body_ratio         = abs(close - open) / bar_range
upper_wick_ratio   = (high - max(open, close)) / bar_range
lower_wick_ratio   = (min(open, close) - low)  / bar_range

recent_high = highest(high, 5)[1]       // 1 bar shifted
recent_low  = lowest(low,  5)[1]
```

### HTF (240m=4h)

```
htf_fast = EMA(close, 21) on 240m bars
htf_slow = EMA(close, 55) on 240m bars
htf_bias = htf_fast > htf_slow ? "BULL" : htf_fast < htf_slow ? "BEAR" : "NEUTRAL"
```

→ **HTF bars 는 별도 fetch 필요**. 현재 server-primary-tick 이 fetch 하는지 확인 필요 (Phase 2.5 항목).

---

## 3. Market State Engine

```
state_bull       = ema_fast > ema_mid > ema_slow AND slope_fast>0 AND slope_mid>=0 AND trend_strength_raw >= 0.22 (state_trend_min)
state_bear       = mirror
state_transition = !state_bull AND !state_bear AND trend_strength_raw >= 0.121 (= 0.22*0.55)
state_chaos      = atr_ratio >= 0.0350 (panic_atr_min) OR (upper_wick>=0.44 AND lower_wick>=0.44 AND body<=0.28)
state_dead       = atr_ratio <= 0.0014 (dead_atr_max) AND vol_ratio <= 0.72
market_state     = chaos? "CHAOS" : bull? "BULL" : bear? "BEAR" : transition? "TRANSITION" : "RANGE"
```

---

## 4. Opportunity Score (LONG; SHORT 는 대칭)

### Sub-scores (전부 [0,1])

```
close_pos_in_bar  = clamp01((close - low) / bar_range)
bull_close        = close > open AND close_pos_in_bar >= 0.55
reclaim_strength_long = clamp01(0.45*(close>ema_fast) + 0.30*close_pos_in_bar + 0.25*(low<=ema_fast))

structure_alignment_long = market_state=="BULL"? 1.0
                          : market_state=="TRANSITION"? (ema_fast>=ema_mid? 0.82 : close>=ema_fast? 0.62 : 0.45)
                          : market_state=="RANGE"? 0.40
                          : 0.15

directional_pressure_long = clamp01(
    0.38 * clamp01((rsi_val - 45.0) / 25.0)
  + 0.34 * clamp01((macd_hist + atr_ratio*0.6) / (atr_ratio*1.8 + 1e-6))
  + 0.28 * clamp01((close - ema_mid) / (atr*1.5 + 1e-6))
)

pullback_quality_long = clamp01(
    0.55 * clamp01(1.0 - abs(price_position - 0.42) / 0.42)
  + 0.45 * reclaim_strength_long
)

participation = clamp01(0.55 * clamp01(vol_ratio/1.8) + 0.45 * clamp01(atr_ratio/0.01))

continuation_pressure_long = clamp01(
    0.42 * (close > ema_fast)
  + 0.28 * clamp01(body_ratio / 0.7)
  + 0.30 * (macd_hist >= macd_hist[1])
)

risk_efficiency_long = clamp01(
    0.60 * (price_position <= 0.92 (max_extension_long))
  + 0.40 * (close >= ema_anchor * 0.97 ? 1.0 : 0.35)
)
```

### Final composite

```
long_opportunity =
    0.22 * structure_alignment_long
  + 0.20 * directional_pressure_long
  + 0.18 * pullback_quality_long
  + 0.12 * participation
  + 0.14 * continuation_pressure_long
  + 0.14 * risk_efficiency_long
```

---

## 5. Trigger Engine

```
pullback_depth_ok_long = price_position >= 0.34 AND price_position <= 0.82

trigger_breakout_long     = close > recent_high AND close > ema_fast AND bull_close AND body_ratio >= 0.46
trigger_reclaim_long      = close > ema_fast AND low <= ema_fast AND close >= ema_mid*0.998
                            AND reclaim_strength_long >= 0.68 AND bull_close AND directional_pressure_long >= 0.42
                            AND (market_state != "TRANSITION" OR transition_bias_long)
                            // transition_bias_long = market_state=="TRANSITION" AND ema_fast >= ema_fast[2]
trigger_continuation_long = close > ema_fast AND ema_fast >= ema_mid AND pullback_depth_ok_long
                            AND bull_close AND macd_hist >= macd_hist[1]

trigger_type_long = breakout? "BREAKOUT" : reclaim? "RECLAIM" : continuation? "CONTINUATION" : "NONE"
trigger_long      = trigger_type_long != "NONE"
```

(SHORT 는 모든 부등호 반전, `bear_close = close<open AND close_pos_in_bar<=0.45`)

---

## 6. Risk Engine

```
long_stop   = close - atr * stop_atr           // stop_atr=1.8 default
long_target = close + atr * target_atr         // target_atr=2.8 default
long_rr     = (long_target - close) / (close - long_stop)

extension_long_block = price_position > 0.92 (max_extension_long)
htf_conflict_long    = htf_bias == "BEAR"

hard_block_long = long_rr < 1.45 (min_rr) OR extension_long_block OR state_dead OR state_chaos

risk_ok_long_early = !hard_block_long
risk_ok_long_core  = !hard_block_long AND !htf_conflict_long
```

(SHORT 대칭. extension_short_block: `price_position < 0.08`, htf_conflict_short: htf_bias=="BULL")

---

## 7. Final raw signals (line 214-220)

```
long_early_raw = long_opportunity >= 0.56 AND (trigger_reclaim_long OR trigger_breakout_long)
                 AND risk_ok_long_early AND structure_alignment_long >= 0.40
                 AND directional_pressure_long >= 0.42 AND anti_chop_gate

long_core_raw  = long_opportunity >= 0.68 AND (trigger_continuation_long OR trigger_breakout_long)
                 AND risk_ok_long_core AND structure_alignment_long >= 0.62
                 AND participation >= 0.42 AND transition_core_quality_long

short_early_raw, short_core_raw = mirror

anti_chop_gate = market_state != "RANGE" OR participation >= 0.52 OR trend_strength_raw >= 0.198 (= 0.22*0.9)

transition_core_quality_long = market_state != "TRANSITION" OR (
   transition_bias_long AND structure_alignment_long >= 0.82 AND participation >= 0.54
   AND directional_pressure_long >= 0.52 AND continuation_pressure_long >= 0.58
   AND body_ratio >= 0.50 AND price_position >= 0.38 AND price_position <= 0.74
)
```

---

## 8. Signal payload schema (pine line 270-318 — server side 도 동일)

서버측에서 `runV2DiscoveryCanaryServerSignalHandoff` 로 fan-in 시킬 때 외부 webhook 과
**동일 schema** 로 만들면 기존 fillSync/intent/handoff/canonical_exit_reducer 가 변경 없이 흡수.

```json
{
  "exchange": "BINANCEFUT",
  "symbol": "BTCUSDT",
  "tf": "5",
  "strategy_id": "donbeolja_v6.1.1.0",
  "engine_mode": "CLEAN_REDESIGN",
  "action": "ENTRY",
  "event_intent": "ENTRY",
  "event": "LONG",            // or "SHORT"
  "side": "BUY",              // or "SELL"
  "direction": "LONG",
  "entry_grade": "CORE",       // or "EARLY"
  "qty_profile": "FIXED",
  "qtyPct": 1.0,
  "price": 67342.5,
  "stop_price": 67100.2,
  "target_price": 67987.8,
  "rr": 1.78,
  "opportunity_score": 0.71,
  "market_state": "BULL",
  "htf_bias": "BULL",
  "trigger_type": "CONTINUATION",
  "risk_mode": "PASS",
  "bar_close_time_utc_ms": 1777366800000,
  "bar_time": 1777366800000,
  "features": {
    "strategy_id": "donbeolja_v6.1.1.0",
    "engine_mode": "CLEAN_REDESIGN",
    "entry_grade": "CORE",
    "qty_profile": "FIXED",
    "market_state": "BULL",
    "htf_bias": "BULL",
    "trigger_type": "CONTINUATION",
    "risk_mode": "PASS",
    "opportunity_score": 0.71,
    "rr": 1.78,
    "stop_price": 67100.2,
    "target_price": 67987.8,
    "_event_intent": "ENTRY",
    "signal_family": "LONG",
    "source_band": "CORE",

    // server-native 메타데이터 추가
    "source": "V2_SERVER_ENTRY_SIGNAL_GENERATOR",
    "v2_server_native": true,
    "engine_version": "v2_pine_v6_1_1_0_parity_001"
  }
}
```

추가 필드:
- `features.source = "V2_SERVER_ENTRY_SIGNAL_GENERATOR"` — production logs/dashboard 분기용
- `features.v2_server_native = true` — V2 가 자체 만든 신호 표시
- `features.engine_version` — 추후 evolution 시 이전 버전과 구분

---

## 9. Implementation plan

### Phase 2: `src/v2/serverEntrySignalGenerator.js` 신규 모듈

**Public API:**
```js
async function generateV2EntrySignals({
  exchange, symbol, tf,
  bars,         // 최소 200 bars 필요 (EMA144 + lookback safety)
  htfBars,      // 최소 70 bars (HTF EMA55 + safety)
  position,     // 현재 포지션 상태 (state, size_pct) — 비어있어야 ENTRY 평가
  cooldownState,// { last_long_signal_bar, last_long_trigger, last_short_signal_bar, last_short_trigger }
  params,       // { thr_early=0.56, thr_core=0.68, same_dir_cooldown_bars=8, ... }
  runId,
  barCloseMs,
} = {}) → {
  signals: [signal_payload, ...],   // 0~1 entries 발화 (LONG/SHORT 동시 fire 금지: pine 도 자연적으로 다 못 통과)
  diagnostics: { market_state, htf_bias, long_opportunity, short_opportunity, ... },
  cooldownStateNext: { ... },        // 호출 측이 Firestore 에 persist
}
```

**Internal helpers (모두 in-file):**
- `ema(values, period)` — `(close * k) + (ema_prev * (1-k))`, `k = 2/(period+1)`, seed=SMA(period)
- `sma(values, period)`
- `rsi(closes, period=14)` — Wilder smoothing
- `macd(closes, 12, 26, 9)` → `{ macd_line, signal, hist }`
- `atr(highs, lows, closes, period=14)` — Wilder true range smoothing
- `highest(values, period)`, `lowest(values, period)`

**deterministic**: 모든 indicator 가 closed-form, no randomness, no external state.

### Phase 2.5: HTF bars source

`paperBinanceRunner.js` 가 1m/5m/15m bars 만 fetch 하는지 240m 도 함께 fetch 하는지 확인.
없으면 `runOneMarket` 안에 `await queryBars({ exchange, market, tf: "240", limit: 70 })` 추가.

### Phase 3: paperBinanceRunner 통합

`paperBinanceRunner.js:14670` 의 `internalSignalsRaw` 빌드:
```js
const internalSignalsRaw = [
  ...nativeInitialSignals,
  ...generateSignals({ /* V1 EXIT-only */ }),
  ...generateV2EntrySignals({ /* V2 ENTRY */ }),  // 추가
  ...(liqSignal ? [liqSignal] : []),
  ...(timeStopSignal ? [timeStopSignal] : []),
];
```

조건:
- 포지션 비어있을 때만 (`pos.state !== "ACTIVE"` OR `size_pct == 0`)
- `executionEnabled === true` AND `actorAllowed === true` (gate pass)
- `cooldownState` 는 Firestore `v2_server_entry_cooldown` collection (key = `${exchange}__${symbol}__${tf}`)

### Phase 4: Tests

- **Unit**: `src/tests/v2-server-entry-signal-generator.test.js`
  - indicator parity (EMA/RSI/MACD/ATR vs known reference values)
  - state engine cases (bull/bear/transition/chaos/dead boundary)
  - opportunity score smoke (sub-score linearity, clamp)
  - trigger detection cases (breakout/reclaim/continuation 각각)
  - cooldown logic (same trigger 8 bar 내 → block, trigger 변경 → allow)
- **Integration**: smoke test 통합 시점에서 paperBinanceRunner 가 generator 결과를 fan-in 하는지

### Phase 5: Canary 배포

- production 배포 전: `DONBEOLJA_V2_SERVER_ENTRY_SIGNAL_GENERATOR_ENABLED=0` 으로 default off
- canary period: dry-run 모드로 server-signal 만들고 firestore signals 컬렉션 stamp + alert 만 보내고 실제 entry 는 안 함
- pine 신호 (TV webhook 임시 허용) 와 서버 신호의 drift 비교 (`SERVER_VS_PINE_SHADOW_COMPARISON_RUNBOOK.md` 참고)
- drift 가 작으면 canary 해제 후 entry 활성화

---

## 10. 알려진 Pine ↔ JS 차이 (parity 위험 포인트)

| 영역 | pine 동작 | JS 포팅 시 주의 |
|---|---|---|
| EMA seeding | first value 는 SMA(period) 로 seed (TV 동작) | `technicalindicators` npm 도 동일. 직접 구현 시 SMA seed 필수 |
| RSI initial | Wilder smoothing 첫 값은 SMA(gain)/SMA(loss) | 동일 |
| MACD seed | EMA fast & slow 먼저 seed → MACD line → signal EMA seed | 동일 |
| ATR initial | first value SMA(TR, 14) | 동일 |
| `[1]`, `[5]` 인덱싱 | bar 0 = 현재, bar 1 = 직전, 등 | JS 배열에서 index N-1 = 현재, N-1-1 = 직전 |
| `time_close` | 현재 bar 의 close timestamp (ms) | bar.barCloseTimeUtcMs |
| `barstate.isconfirmed` | 종가가 확정된 bar | server 는 closed bar 만 받으므로 항상 true |
| `bar_index` | 차트 시작부터의 bar 번호 (state 변수 cooldown 계산용) | server 측에서는 `barCloseMs / tfMs` 또는 절대 시각 사용 |

cooldown 의 `bar_index - last_long_signal_bar > 8` 은
JS 에서는 `(currentBarCloseMs - lastSignalBarCloseMs) / tfMs > 8` 으로 표현.

---

## 11. Rollout 순서

1. **이 PR (Phase 1)**: 본 plan 문서 + Pine 분석 commit
2. **Phase 2 PR**: `serverEntrySignalGenerator.js` + indicator + 단위 테스트
3. **Phase 2.5 PR**: HTF bars fetch 추가 (필요 시)
4. **Phase 3 PR**: paperBinanceRunner 통합 (env flag 로 default off)
5. **Phase 4 PR**: integration smoke + drift report tooling
6. **Phase 5**: canary deploy → drift 검증 → flag on

각 PR 별 npm test + orphans 통과 + master push + Cloud Build SUCCESS 확인 후 다음 단계.

---

## 12. Out-of-scope (이번 작업 안에서는 안 함)

- V1 paperBinanceRunner 의 `generateSignals` 변경 (EXIT only 그대로 유지)
- V2 의 더 진화된 strategy (e.g., ML-based, multi-TF fusion) — 일단 pine parity 만
- TV webhook 차단 해제 (`DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL=1` 그대로)
- 실시간 ticks (1m bar 미만 trigger) — pine 도 bar close 기준이니 동일
