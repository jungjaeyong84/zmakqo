# DONBEOLJA V2 Hardening Design

| Field | Value |
|---|---|
| Document version | 1.3 current-progress |
| Written at | 2026-04-26 KST |
| Target period | 2026-04-26 ~ 2026-06-30, about 9 weeks |
| Baseline commit | `8b5f46231239ee5ce03dc7cbec246cd2a3c1cc20` |
| Baseline image | `gcr.io/donbeolja-dev/donbeolja:v2-8b5f4623` |
| Baseline Cloud Run revision | `donbeolja-01530-dph` |
| Baseline CloudBuild | `113166f5-d12a-4fe5-a2e2-36d1a8013bac` |
| Target system | DONBEOLJA V2 Discovery Canary live-write |

## 1. Purpose

This plan hardens the existing V2 Discovery Canary live-write system until Formal LIVE promotion is blocked only by realized performance evidence, not by known infrastructure, safety, observability, V1-retirement, or operating-process gaps.

The plan does not attempt to improve alpha. It is about not losing money because of infrastructure mistakes while enough live evidence is collected.

## 2. Goals And Non-Goals

### Goals

- Close all current HIGH/MEDIUM safety findings.
- Maintain Discovery Canary live-write with active protection reconciliation always green.
- Accumulate at least 30 days of safety streak evidence.
- Accumulate performance evidence toward `sample_n >= 200`.
- Reach T3 / mid-tier prop-shop infrastructure maturity where Formal LIVE promotion is a statistical evidence decision only.

### Non-Goals

- No new alpha model.
- No new ML training or live learner apply.
- No new exchange, timeframe, or symbol universe beyond the current approved 8-symbol canary set.
- No multi-region active-active.
- No Formal LIVE promotion inside this plan.
- No Claude/OpenAI/news reactivation.
- No capital expansion before P0 is fully closed and 7-day post-P0 safety streak passes.

## 3. Current Baseline Snapshot

| Item | Current baseline |
|---|---|
| Mode | V2 `DISCOVERY_CANARY` live-write |
| Formal LIVE | Disabled by `CANARY_ONLY=1` and performance gate |
| Runtime manifest | PASS at baseline commit |
| Active protection reconciliation | PASS, active=4, protected=4, unprotected=0 at 2026-04-26 post-deploy check |
| Active symbols at baseline check | `BTCUSDT`, `BNBUSDT`, `XRPUSDT`, `SOLUSDT` |
| `system_settings.live_enabled` | false, discovery enabled, canary-only true |
| Scheduler health drift | PASS |
| Entry route canary streak | BLOCKED by old unhealthy rows until approximately 2026-04-27 10:06 KST; do not delete or fake history |
| Performance sample | `sample_n=0`, Formal LIVE blocked |
| AI/news external cost paths | Disabled by env and manifest forbidden key checks |
| V1 entry/add | hard-denied for V2 discovery path |
| V1 exit/direct writer | hard-denied for V2 discovery bridge / legacy runtime disabled; transport regression test required in CI |

## 4. Safety Principles

1. Evidence absence means block.
2. V2 protected entry is the only live-write entry path.
3. V1 `paperBinanceRunner` must not directly write to exchange while V2 discovery live-write is enabled.
4. `liveEnabled` is a transport capability, not proof that legacy V1 writers may write.
5. Initial protection, repair protection, refresh, and cancel/replace all need bounded deadlines and abort propagation.
6. Operator alerts must describe execution truth, not legacy lifecycle artifacts.
7. Rollback flags cannot weaken protection guarantees unless explicitly scoped to local test or emergency rollback.
8. Formal LIVE cannot be unlocked by operator intent alone; performance evidence and 30-day safety evidence are mandatory.

## 5. Phase Overview

```text
P0  D+0  ~ D+5   Money-losing path closure
  |
  +-- 7-day post-P0 safety streak
      |
P1  D+6  ~ D+19  HA foundation, Firestore lease, risk policy consistency, V1 isolation stage A
      |
      +-- 7-day post-P1 safety streak
          |
P2  D+20 ~ D+38  V1 cleanup, exit-worker HA, alert escalation, incident drills
          |
          +-- 7-day post-P2 safety streak
              |
P3  D+39 ~ D+60  Evidence accumulation and Formal LIVE readiness gate
```

No phase may start until its entry gate passes.

## 6. P0 Status And Scope

P0 is about blocking paths that can immediately lose money or produce false operational truth.

| P0 item | Current status at baseline | Remaining work |
|---|---|---|
| P0-1 Initial protection deadline/abort | Complete in code. Initial SL/TP1 use `withProtectionWriteDeadline`; late-placed reconciler evidence exists. | Keep in `test:v2-promotion` / runtime-chain regression. |
| P0-2 Drop consumed-lock suppress | Complete in code. `recordSignalDrops` suppresses consumed/locked signals and persists forensic rows; riskGovernor reason surface is normalized. | Keep webhook/paperRunner race regression. |
| P0-3 V1 direct exchange writer deny | Complete in code. `legacyV1ExchangeWriterEnabled` axis exists and V1 writer deny covers ENTRY/ADD/EXIT under V2 discovery / legacy runtime disabled. | Keep V2 transport unaffected regression in CI. |
| P0-4 TP1 strict reconciliation | Complete in code. TP1 strict candidate validation and stale `tp_p1_pending` CRIT are implemented. | Keep exit integrity regression. |
| P0-5 Telegram runtime context | Complete. Runtime alerts include `max_pos`, `max_trades`, `daily_loss_halt`, `risk_total`, `risk_symbol`, `risk_group`. | Keep in regression tests. |

P0 code closure is complete at baseline. P0 phase closure still requires the entry-route canary streak to clear old unhealthy rows naturally, then a fresh gate run: `npm run test:v2-promotion`, runtime manifest PASS, active protection PASS, system settings live disabled PASS, scheduler drift PASS, and entry route canary streak PASS.

## 7. P0 Detailed Design

### P0-1. Initial Protection Late-Placed Reconciliation

#### Problem

Initial SL/TP1 placement now has deadline/abort, but Binance can still place an order after the client deadline. Without reconciliation, the system could attempt duplicate protection repair or incorrectly classify the position as unprotected.

#### Current Baseline

- `src/v2/binanceInitialProtectionTransport.js` wraps `placeInitialSl` and `placeInitialTp1` in `withProtectionWriteDeadline`.
- `src/v2/productionRuntimeChainAudit.js` verifies initial SL/TP1 deadline coverage.
- Tests cover abort signal forwarding.

#### Remaining Change

Add `src/v2/initialProtectionLatePlacedReconciler.js`.

Responsibilities:

- Poll Binance by `clientOrderId` / idempotency key for up to 60 seconds after `BINANCE_INITIAL_*_WRITE_DEADLINE_EXCEEDED`.
- If late order exists and matches expected symbol, side, trigger, closePosition/reduceOnly/qty contract, mark evidence as `late_placed_after_abort=true`.
- If late SL/TP1 is found, repair must not place a duplicate order for that leg.
- If late order is not found, bubble `unprotected_position_possible=true` to endpoint and repair queue.

#### Required Invariants

- Every initial protection placement either gets an ack inside deadline or creates structured timeout evidence.
- Late placement discovery must be idempotent.
- Late placement evidence must be attached to protection runtime docs and repair request context.

#### Tests

Create `src/tests/v2-initial-protection-deadline.test.js`.

Required cases:

- Mock hanging SL transport -> `BINANCE_INITIAL_SL_WRITE_DEADLINE_EXCEEDED`.
- Mock hanging TP1 transport -> `BINANCE_INITIAL_TP1_WRITE_DEADLINE_EXCEEDED`.
- Deadline then late Binance order found -> `late_placed_after_abort=true`, no duplicate repair for that leg.
- Deadline then no late order -> `unprotected_position_possible=true`, repair queued.
- Endpoint returns post-fill critical if protection remains incomplete.

#### Rollback

No normal rollback flag. Do not allow an env flag that disables protection deadline in production. If an emergency rollback is needed, rollback Cloud Run revision.

### P0-2. Suppressed Drop Forensic Ledger And RiskGovernor Reason Surface

#### Problem

Consumed/locked signal drops are now suppressed, but suppressed rows are not yet persisted in a dedicated forensic collection. Also, riskGovernor block reasons need the same shape in handoff details and Telegram.

#### Current Baseline

- `src/storage/signalDrops.js` filters consumed/locked drops before writing normal drop rows and sending alerts.
- `SIGNAL_DROP_SUPPRESSED_ALREADY_CONSUMED` is observable in logs.

#### Remaining Change

- Add collection `v2__signals_dropped_suppressed`.
- Persist every suppressed drop with `signal_id`, `run_id`, original drop payload subset, suppress reason, source call site if available, `created_at`.
- Add normalized risk governor surface schema:

```json
{
  "risk_governor": {
    "ok": false,
    "reason": "GROUP_NOTIONAL_EXCEEDED",
    "blockers": ["RISK_GROUP_NOTIONAL_EXCEEDED"],
    "policy": {
      "risk_total": 300,
      "risk_symbol": 155,
      "risk_group": 300
    }
  }
}
```

#### Required Invariants

- `recordSignalDrops` is the single suppress point for all drop callers.
- A consumed/locked signal cannot emit a later normal drop alert.
- Suppressed drops are not discarded; forensic row is written.
- Risk governor block reason is identical in route result, handoff detail, and Telegram body.

#### Tests

Create `src/tests/signal-drop-consume-lock-suppression.test.js`.

Required cases:

- Consumed signal -> normal drop rows 0, alerts 0, suppressed ledger 1.
- Locked signal -> normal drop rows 0, alerts 0, suppressed ledger 1.
- Free signal -> existing normal drop behavior.
- Missing signal id -> existing normal drop behavior.
- Webhook and paper runner simultaneous calls -> only one execution truth, no contradictory alert.

Create `src/tests/handoff-risk-governor-reason-surface.test.js`.

Required cases:

- `V2_RISK_GOVERNOR_BLOCKED` includes normalized reason in handoff detail.
- Telegram includes `riskGovernor: GROUP_NOTIONAL_EXCEEDED` or equivalent exact Korean line.

#### Rollback

`DONBEOLJA_SIGNAL_DROP_CONSUME_LOCK_ENABLED=0` may be allowed only for local/integration testing. Production default must be enabled, and runtime manifest must fail if disabled.

### P0-3. V1 PaperRunner Direct Exchange Writer Deny

#### Problem

The current baseline denies legacy EXIT under V2 bridge or legacy runtime disabled, but the design should be explicit and auditable: V1 writer identity must be denied separately from V2 transport capability.

#### Required Change

Introduce separate axes in `resolveLiveFuturesConfig`:

- `liveEnabled`: V2 transport capability.
- `legacyV1ExchangeWriterEnabled`: whether V1 paperRunner-originated exchange write is allowed.
- `legacy_runtime_disabled`: env/runtime state.
- `v2DiscoveryCanaryBridge`: active V2 handoff path.

Expected logic:

```js
const legacyV1ExchangeWriterEnabled = liveEnabled
  && legacyRuntimeDisabled !== true
  && discoveryBridge.ok !== true;
```

All V1 direct exchange write call sites must check the V1 writer axis before any `placeFutures*` call.

#### Required Invariants

- If `DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED=1`, V1 paperRunner cannot write ENTRY, ADD, EXIT, reduceOnly, stop, or TP orders.
- If `v2DiscoveryCanaryBridge=true`, V1 paperRunner cannot write any exchange order regardless of intent.
- V2 transports are unaffected and may still place initial SL/TP1 and repair/refresh protection.

#### Audit Scope

Audit all `paperBinanceRunner` paths around:

- direct entry market/maker orders
- add orders
- reduceOnly exits
- stop/TP placement from V1 code paths
- fallback live-enabled paths driven by Firestore `system_settings.live_enabled`

#### Tests

Create `src/tests/v1-legacy-exchange-writer-deny.test.js`.

Required cases:

- Bridge true, intent ENTRY -> denied.
- Bridge true, intent ADD -> denied.
- Bridge true, intent EXIT -> denied.
- Legacy runtime disabled, bridge false -> denied.
- V2 transports unaffected by V1 deny.

Create `src/tests/v2-transports-unaffected-by-v1-gate.test.js`.

Required cases:

- Initial SL/TP1 transport still places under V2 route.
- Repair protection transport still places under V2 repair.

#### Rollback

Do not add a broad production rollback flag that revives V1 writers. If rollback is needed, roll back the revision. A local-only env may exist for legacy tests, but production manifest must require V1 writer deny.

### P0-4. TP1 Pending Expiry Escalation

#### Problem

A fresh `tp_p1_pending=true` can reasonably suppress TP1 missing alarms for a short window. A stale pending flag must not suppress missing TP1 detection.

#### Required Change

In `src/services/exitIntegrityAudit.js`:

- Treat TP1 as done only when `tp_p1_done=true` or `trail_active=true`.
- Treat TP1 pending as valid only when `tp_p1_pending=true` and `tp_p1_pending_until_ms > now`.
- If pending is expired, emit `TP1_PENDING_EXPIRED_STILL_PENDING` as `CRIT`.
- If pending is expired and no strict TP1 order exists, emit both expired pending and TP1 missing critical evidence.

#### Required Invariants

- Stale pending cannot hide missing TP1.
- Fresh pending has bounded time window.
- Done/trail-active states still suppress TP1 open-order requirement.

#### Tests

Create `src/tests/exit-integrity-tp1-pending-expired.test.js`.

Required cases:

- Fresh pending -> no TP1 missing critical.
- Expired pending + missing TP1 -> CRIT.
- `tp_p1_done=true` -> skip TP1 open-order requirement.
- `trail_active=true` -> skip TP1 open-order requirement.

### P0-5. Telegram Runtime Context Regression Lock

#### Current Baseline

Complete.

Required fields in every V2 Telegram runtime context:

- `dry_run`
- `canary_only`
- `formal_live`
- `live_endpoint`
- `ml_live`
- `agent_apply`
- `legacy_webhook`
- `symbols`
- `fallback_notional`
- `symbol_notional`
- `max_pos`
- `max_trades`
- `daily_loss_halt`
- `risk_total`
- `risk_symbol`
- `risk_group`

Regression test: `src/tests/telegram-alert-korean.test.js`.

## 8. P1 Scope: HA Foundation And Policy Consistency

P1 starts only after P0 completion and a 7-day post-P0 streak:

- `unprotected_position_n=0`
- `post_fill_critical_n=0`
- no contradictory drop/executed alert
- scheduler drift PASS
- runtime manifest PASS

### P1-1. Firestore-Backed Repair Lease

Problem: in-process repair lease is not sufficient for multi-instance HA.

Add Firestore transaction lock:

- Collection/doc pattern: `runtime_locks/v2_protection_writer_lease__{position_cycle_id}`.
- Fields: `lease_holder_instance_id`, `acquired_at`, `expires_at`, `position_cycle_id`, `placement_attempt_id`, `command_type`.
- TTL: 60 seconds.
- Heartbeat: 10 seconds.
- Release in `finally`.

Tests:

- simultaneous acquire, only one succeeds
- TTL expiry allows acquire
- heartbeat extends lease
- release clears lease
- command/cycle mismatch denied

### P1-2. Algo Endpoint Unavailable Escalation

Current baseline escalates algo endpoint unavailable to CRIT in V2 live-write runtime. P1 adds duration-based persistence:

- Track first seen timestamp in Firestore.
- If endpoint unavailable exceeds `DONBEOLJA_V2_ALGO_ENDPOINT_DEGRADED_CRIT_AFTER_MS` default 600000 ms, alert CRIT repeatedly until recovery.
- Recovery clears degraded state.

### P1-3. Self-Evolution Data Hygiene

Discovery Canary fills must not contaminate Formal LIVE learner datasets.

Required change:

- Route canary live-write outcome rows to a canary/shadow dataset namespace.
- Formal LIVE learner/promotion datasets must require explicit `formal_live=true` source or equivalent signed promotion context.

### P1-4. Discovery Notional And Risk Cap Consistency

Current caps can conflict: BTC 230 plus group cap 250 can block other BTC-beta symbols after one BTC position. A lower BTC cap such as 80 is not viable because Binance step size makes the 50% TP1 quantity round to zero. The chosen map therefore uses the minimum notional that can still place entry plus 50% TP1 for each approved symbol, and raises risk total/group caps to 300 so riskGovernor does not create an accidental hidden blocker.

Before changing caps, produce an artifact explaining the chosen map and expected group usage. Candidate map:

```text
BTCUSDT:155|ETHUSDT:42|LINKUSDT:41|BNBUSDT:13|XRPUSDT:11|SOLUSDT:11|AXSUSDT:12|DOGEUSDT:11
```

No cap change is allowed without:

- active position count and symbol distribution evidence
- group exposure simulation
- riskGovernor dry-run showing intended symbols are not unexpectedly blocked

### P1-5. RiskGovernor Reason Schema Unification

Unify risk governor surface across:

- production entry route response
- discovery handoff detail
- Telegram alert
- audit ledger

### P1-6. Active Protection Reconciliation Hourly

Move active protection reconciliation to hourly scheduler if not already active.

Required alert behavior:

- unprotected position -> CRIT immediately
- repeated same issue -> backoff after first CRIT but never suppress status artifact
- daily summary -> active/protected/unprotected counts

### P1-7. V1 PaperRunner Stage A Isolation

After P0 V1 writer deny and 7-day V1 writer call count zero:

- Move V1 direct exchange write helpers to `src/engine/legacy/`.
- Add explicit `LEGACY_V1_DEAD_CODE` markers.
- Add source audit preventing new direct V1 writer imports outside legacy module.

No physical deletion in P1.

## 9. P2 Scope: V1 Cleanup, HA, Escalation, Drills

P2 starts only after P1 completion and a 7-day post-P1 safety streak.

### P2-1. V1 Cleanup Stage B/C

- Stage B: Mark dead code and add lint/source audit guard.
- Stage C: Split `paperBinanceRunner` into smaller modules.
- Physical deletion is deferred until 30-day `V1 placeFutures* call_n=0` evidence exists.

### P2-2. Exit Worker HA

Requires P1 Firestore repair lease.

Target:

- min instances: 2
- max instances: 2

Drill:

- Kill one worker instance.
- Verify lease takeover.
- Verify no duplicate protection write.

### P2-3. Alert Escalation Router

Add `src/v2/alertEscalationRouter.js`.

Routing:

- INFO/WARN -> canary channel
- ERROR -> ops channel
- CRITICAL -> ops channel and repeat every 5 minutes until ack or recovery

### P2-4. Incident Drills

Required drills:

- exit-worker instance failure
- Firestore `system_settings.live_enabled=true` accidental toggle
- Binance API / algo endpoint degraded for 5 minutes
- Telegram delivery outage

Each drill requires artifact and postmortem note.

## 10. P3 Scope: Evidence And Formal LIVE Readiness

P3 starts only after P2 completion and a 7-day post-P2 safety streak.

### P3-1. Daily Evidence Snapshot

Add `scripts/collect-v2-evidence-snapshot-daily.js`.

Output path: `ops/daily/v2_evidence_streak.jsonl`.

Required fields:

```json
{
  "date": "2026-05-15",
  "sample_n_total": 38,
  "sample_n_30d": 38,
  "profit_factor_30d": 1.05,
  "expectancy_30d_quote": 0.18,
  "net_pnl_30d_quote": 6.84,
  "win_rate_30d": 0.42,
  "max_drawdown_30d_quote": 4.2,
  "active_protection_streak_days": 21,
  "post_fill_critical_30d": 0,
  "v1_place_futures_call_n_30d": 0,
  "performance_gate_status": "ACCUMULATING"
}
```

### P3-2. 30-Day Safety Streak Evaluation

All conditions must pass daily:

- active protection reconciliation PASS
- `unprotected_position_n=0`
- repair queue lag p95 < 60 seconds
- `post_fill_critical_n=0`
- algo endpoint degraded duration < 10 min/day
- V1 direct exchange writer calls = 0
- no contradictory alert/fill reconciliation issue
- Cloud Run revision drift = 0

### P3-3. Daily Performance Gate Evaluation

Run `node scripts/check-v2-performance-gate.js` daily and summarize:

- `sample_n`
- `profit_factor`
- `expectancy_r`
- `net_pnl_pct`
- fee/funding/slippage inclusion status
- current stage: DISCOVERY/CANARY/LIVE blocked/pass

### P3-4. Formal LIVE Promotion Readiness Script

Add `scripts/check-v2-formal-live-promotion-readiness.js`.

Required AND conditions:

| Condition | Threshold |
|---|---:|
| `sample_n_30d` | >= 200 |
| `profit_factor_30d` | >= 1.15 |
| bootstrap PF lower CI | > 1.0 |
| `expectancy_r_30d` | > 0 |
| `net_pnl_30d` | > 0 |
| `win_rate_30d` | >= 0.40 |
| max drawdown / equity | < 0.05 |
| active protection streak | >= 30 days |
| `post_fill_critical_30d` | 0 |
| repair queue lag p95 | < 60 seconds |
| V1 direct exchange writer calls | 0 |
| Cloud Run revision drift | 0 |
| fee/funding/slippage included | true |
| symbol/regime breakdown present | true |
| tail loss / MAE report present | true |

Even if all pass, Formal LIVE still requires operator multi-eye approval and a 24-hour cooldown. This plan does not perform Formal LIVE promotion.

## 11. Phase Gates

### P0 -> P1 Required Gate

```bash
node scripts/check-v2-runtime-discovery-canary-manifest.js
node scripts/check-v2-active-protection-reconciliation.js
node scripts/check-v2-system-settings-live-disabled.js
node scripts/check-v2-scheduler-health-drift.js
node scripts/check-v2-production-runtime-chain.js
npm run test:v2-promotion
```

Plus P0-specific tests:

```bash
node src/tests/v2-initial-protection-deadline.test.js
node src/tests/signal-drop-consume-lock-suppression.test.js
node src/tests/handoff-risk-governor-reason-surface.test.js
node src/tests/v1-legacy-exchange-writer-deny.test.js
node src/tests/v2-transports-unaffected-by-v1-gate.test.js
node src/tests/exit-integrity-tp1-pending-expired.test.js
```

### P1 -> P2 Required Gate

All P0 -> P1 gates plus:

```bash
node scripts/check-v2-repair-lease-firestore-tx.js
node scripts/check-v2-algo-endpoint-escalation.js
node scripts/check-v2-v1-writer-deny-streak.js
```

### P2 -> P3 Required Gate

All previous gates plus:

```bash
node scripts/check-v2-exit-worker-ha-streak.js
node scripts/check-v2-incident-drill-evidence.js
```

### P3 End Gate

```bash
node scripts/check-v2-formal-live-promotion-readiness.js
```

Expected result before enough data: `FORMAL_LIVE_PROMOTION_BLOCKED`.

## 12. Fast Gate And Full Gate

To avoid operator bypass due to test runtime, gates are split:

### Fast Required Gate

Runs before any production deploy:

```bash
node scripts/check-v2-runtime-discovery-canary-manifest.js
node scripts/check-v2-active-protection-reconciliation.js
node scripts/check-v2-system-settings-live-disabled.js
node scripts/check-v2-scheduler-health-drift.js
node scripts/check-v2-production-runtime-chain.js
npm run test:v2-promotion
```

### Full Nightly Gate

Runs daily or before phase transition:

```bash
npm test
npm run test:v2-promotion
node scripts/check-v2-firestore-cost-guard.js
node scripts/check-v2-performance-gate.js || true
node scripts/check-v2-live-evidence-readiness.js || true
```

A failing full nightly gate freezes phase advancement but does not automatically stop current protected canary unless the failure is safety-critical.

## 13. Rollback Policy

### Code Rollback

Preferred rollback is Cloud Run revision rollback:

```bash
gcloud run services update-traffic donbeolja --region=asia-northeast3 --to-revisions=PREVIOUS_REVISION=100
```

### Safety Flag Policy

- Flags may disable non-critical observability features.
- Flags must not disable protection placement deadline, V1 writer deny, active protection reconciliation, or legacy webhook block in production.
- Any flag that weakens a safety invariant must be local-test-only or require an emergency runbook.

### Phase Freeze

Any of the following freezes phase advancement:

- unprotected position observed
- post-fill protection critical
- contradictory drop/executed alert
- V1 direct exchange writer call
- scheduler drift blocker
- manifest mismatch
- performance artifact corruption

Unfreeze requires fix, root cause note, and a fresh 7-day safety streak.

## 14. KPI

### Safety KPI

| Metric | Threshold |
|---|---:|
| `unprotected_position_n` | 0 always |
| `post_fill_critical_30d` | 0 |
| `algo_endpoint_degraded_duration` | < 10 min/day |
| repair queue lag p95 | < 60 seconds |
| repair lease tx success rate 30d | >= 99.9% |
| contradictory drop/executed alert | 0 |
| V1 direct exchange writer calls 30d | 0 |

### Evidence KPI

| Metric | Threshold |
|---|---:|
| `sample_n_30d` | >= 200 |
| `profit_factor_30d` | >= 1.15 |
| bootstrap PF lower CI | > 1.0 |
| `expectancy_r_30d` | > 0 |
| `net_pnl_30d` | > 0 |
| `win_rate_30d` | >= 0.40 |
| active protection streak | >= 30 days |

### Runtime KPI

| Metric | Threshold |
|---|---:|
| Cloud Run revision drift | 0 |
| forbidden AI/news env keys | 0 |
| OTel error rate | < 0.5% |
| Firestore cost guard | PASS |
| scheduler health drift | PASS |

## 15. T3 Readiness Checklist

- [ ] P0 remaining findings closed.
- [ ] P1 repair lease Firestore transaction completed.
- [ ] P1 risk/notional policy consistency artifact exists.
- [ ] P2 exit-worker HA drill passed.
- [ ] P2 alert escalation drill passed.
- [ ] 30-day active protection streak passed.
- [ ] `sample_n_30d >= 200`.
- [ ] `profit_factor_30d >= 1.15`.
- [ ] bootstrap PF lower CI > 1.0.
- [ ] `expectancy_r_30d > 0`.
- [ ] `net_pnl_30d > 0`.
- [ ] fee/funding/slippage included in performance artifact.
- [ ] symbol/regime breakdown exists.
- [ ] `post_fill_critical_30d = 0`.
- [ ] V1 direct exchange writer calls 30d = 0.
- [ ] Cloud Run revision drift = 0.
- [ ] forbidden AI/news env keys = 0.

All items must pass before Formal LIVE decision is even discussed.

## 16. Immediate Next Work

1. Keep current bounded Discovery Canary running while entry-route unhealthy rows age out naturally.
2. Re-run the full P0 gate after approximately 2026-04-27 10:06 KST.
3. Do not start P2 code or exit-worker HA until P0/P1 gates and the required safety streaks pass.
4. Continue adding regression locks for already-closed P0/P1 invariants.
5. Keep Formal LIVE blocked until performance evidence reaches the documented thresholds.

## 17. Final Position

The current V2 Discovery Canary can continue only at current bounded live-write scale while P0 is completed. It should not expand position count, notional, symbol set, or Formal LIVE exposure until P0 is closed and a 7-day safety streak passes.

Formal LIVE remains blocked by evidence. This plan does not unlock it; it makes the system strong enough that future Formal LIVE debate is about performance statistics, not avoidable infrastructure risk.
