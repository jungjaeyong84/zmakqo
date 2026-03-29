# BEST_SELF_EVOLUTION_DATASET_SPEC

- 제정: 2026-03-29
- 상태: PROPOSED
- 목적: 실행된 신호뿐 아니라 드롭, 차단, fallback, 누락까지 포함한 `unified learning row`를 정의

## 1. row 목적

각 row는 아래 질문에 답해야 한다.

1. 어떤 신호가 있었나
2. 어떤 필터/가드가 개입했나
3. 실제로 체결되었나
4. 얼마를 벌거나 잃었나
5. 드롭/미스/late/fallback 책임은 어디에 있나

## 2. 필수 key

1. `signal_id`
2. `signal_key`
3. `provider`
4. `market`
5. `tf`
6. `side`
7. `event`
8. `signal_bar_close_time_utc_ms`
9. `source_row_type`
   - `EXECUTED`, `DROP`, `MISSED`, `FALLBACK`, `REJECTED`, `PARTIAL`

## 3. 필수 그룹

### signal/pine

1. `features_json`
2. `entry_grade`
3. `market_state_summary_*`
4. `febt_*`

### filter path

1. `integrity_verdict`
2. `quality_verdict`
3. `state_soft_sizing_verdict`
4. `ev_verdict`
5. `wait_verdict`
6. `drop_stage_key`
7. `drop_reason`
8. `fallback_reason`

### execution

1. `intent_created_at_ms`
2. `fill_created_at_ms`
3. `trade_closed_at_ms`
4. `fill_status`
5. `partial_fill`
6. `reject_reason`

### economics

1. `tp1_first`
2. `sl_first`
3. `mfe_pct`
4. `mae_pct`
5. `realized_ret_net`
6. `realized_pnl_quote`
7. `hold_minutes`

## 4. 산출물

1. `ops/daily/best_self_evolution_dataset_latest.json`
2. 시장별/기간별 분할 dataset

## 5. 불변 조건

1. 드롭 row도 버리지 않는다.
2. fallback row도 별도 보존한다.
3. old row 재해석 시 원본 필드는 덮어쓰지 않는다.
