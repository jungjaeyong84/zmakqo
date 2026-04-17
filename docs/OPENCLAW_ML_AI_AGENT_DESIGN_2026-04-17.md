# OpenClaw → ML+AI Decision Agent — Design (2026-04-17)

> **Thesis**: OpenClaw must stop being a downstream gate-only layer and become
> the system's ML+AI decision agent. The leverage is not "more models" — it
> is the set of decisions institutions structurally cannot make: narrative
> reasoning at sub-second latency is a retail-only privilege, and so are
> self-reflection loops, concentrated-portfolio convictions, and per-position
> lifecycle planning. The design below turns those into code, with hard
> safety rails.

---

## 1. Baseline (what we already have)

Verified by import graph (`src/services/openclaw*.js`):

- `openclawExecutionAuthority` wraps `openclawExecutionExecutor`,
  `liveExecutionPolicy`, `entryBudgetGuard`. **No ML / no AI imports.**
- `openclawExecutionExecutor` holds correlation / exposure / cluster /
  allocator-snapshot rules. **No ML / no AI imports.**
- `aiSignalGuard.evaluateSignalWithAi` is upstream; it writes
  `features.ai_signal` which OpenClaw only **reads** as an opaque hint.
- `mlServingRuntime` / `liveInferenceRouter` manage model serving state
  and router bindings but do not drive OpenClaw.

The split is clean today: **AI decides, OpenClaw gates, Policy sizes**.
That is the opposite of what we need.

---

## 2. Target architecture — OpenClaw owns the decision

```
          Raw webhook signal + features
                       │
                       ▼
     ┌─────────────────────────────────┐
     │      OpenClaw Decision Agent     │     ◄── owns the decision
     │   openclawDecisionAgent.js       │
     │                                  │
     │  1. Hard-gate (existing exec     │
     │     authority: exposure / corr / │
     │     budget / sl-writer).         │
     │  2. Soft-gate (per-market TP1    │
     │     probability model,           │
     │     calibrated by the Evidence   │
     │     Ledger).                     │
     │  3. Narrative gate (LLM with     │
     │     regime context + recent      │
     │     failure patterns).           │
     │  4. Composite decision with      │
     │     trust-weighted voting.       │
     │  5. Emits Evidence record.       │
     └─────────────────────────────────┘
                       │
                       ├── ENTRY → order path
                       ├── POSITION OPEN → Conductor
                       └── 4h tick → Retrospect
```

### 2.1 Three agent roles (all under one OpenClaw umbrella)

1. **Signal Decider** (per-signal, seconds)
   - Replaces the current `aiSignalGuard` + `openclawExecutionAuthority`
     chain with a single agent that owns `{accept, qty_scale, exit_contract_hint, reason_trace}`.
2. **Position Conductor** (per-position, minutes to days)
   - Per-tick adjuster that can propose tighter stops, earlier TP1, or
     abort before SL. **Cannot widen SL, cannot remove trailing.**
3. **Retrospect Loop** (per 4h)
   - Reviews the last N trades + decisions + realized outcomes; emits
     pattern hypotheses; proposes parameter drift. Writes to
     `ops/daily/openclaw_retrospect_latest.json`.

All three write to a single **Evidence Ledger**.

### 2.2 Composite decision model

For every decision (accept/reject/scale), three sources vote:

| Source | Trust | Latency | Strength |
|---|---|---|---|
| Rule-based (existing executor) | 1.00 | <10ms | Deterministic, explainable |
| ML probability (per-market TP1 hit) | 0.70 | <50ms | Empirical, statistical |
| Narrative reasoner (LLM) | 0.40 | 1–5s | Context, regime, failure patterns |

Weights are **auto-calibrated** from the Evidence Ledger. A source whose
predictions realize poorly loses trust over a rolling 200-trade window.

The composite is a **veto-and-scale** rule:
- Any HARD gate (rule-based blocker) → reject, full stop.
- If ML probability < `OPENCLAW_ML_MIN_TP1_PROB` (default 0.22) → reject with `ML_LOW_TP1_PROB`.
- Otherwise scale = `softmin(rule_scale, ml_scale, narrative_scale)` clamped to the existing `SCALE_MIN..SCALE_MAX`.
- **Narrative can only reduce**, never amplify. LLM cannot make a big bet.

### 2.3 Evidence Ledger

Every agent action records:

```json
{
  "decision_id": "DEC__<sig>__<ts>",
  "kind": "SIGNAL_DECIDER|POSITION_CONDUCTOR|RETROSPECT",
  "at": "2026-04-17T...",
  "inputs": { "exchange": ..., "symbol": ..., "features_hash": ..., "regime": ... },
  "predictions": {
    "rule": { "accept": true, "scale": 1.0, "reasons": ["OPENCLAW_EXECUTOR_PASS"] },
    "ml":   { "tp1_probability": 0.31, "version_id": "..." },
    "narrative": { "accept": true, "confidence": 0.6, "thesis_hash": "...", "model": "opus-4.7", "prompt_hash": "..." }
  },
  "composite": { "accept": true, "scale": 0.85, "reason_trace": [...] },
  "outcome": null  // filled in post-settlement
}
```

A separate "outcome linker" cycle joins each decision to its realized
outcome (TP1_first, SL_first, trailing_exit, horizon_return). The linker
then updates per-source trust weights.

Storage: Firestore collection `openclaw_evidence_ledger` with doc id =
`decision_id`. Retention: 90 days rolling (self-evolution replay horizon).

---

## 3. What institutions structurally cannot do — our leverage

| Leverage | Why institutions cannot | How OpenClaw uses it |
|---|---|---|
| **2–5s LLM reasoning per signal** | Institutions make 10³–10⁶ decisions/s | We make 5–50/hour. 3s/decision is free. |
| **Narrative thesis per position** | Compliance requires quant-auditable rules | Each position carries an LLM-written "why" we can review/audit |
| **Same-week policy updates from self-reflection** | Model change boards, risk committees, compliance | Retrospect loop can promote "STOP trading regime X" within hours |
| **Aggressive concentration on proven markets** | Diversification is mandated | OpenClaw can double-down on XRPUSDT (82% win rate, 45 trades) |
| **Multi-source data fusion without firewall** | Internal compliance walls (e.g. research vs desk) | We freely read news, on-chain, cross-exchange, Korean retail signals together |
| **Per-position adversarial modeling** | Lack of granular data + time | Conductor models "this position is being hunted" and aborts pre-SL |
| **Asymmetric uptime** | HFT cannot afford a reasoning pause | Our position edge is seconds-to-minutes, not microseconds |
| **Extreme experimentation cadence** | Change management, audit trails | We ship every 4h with a guarded autonomy scope |

The architecture must lean into every one of these.

---

## 4. Hard safety rails (non-negotiable)

These constraints exist even when the agent is fully autonomous:

1. `SCALE_MAX` (1.2x default) caps any agent qty decision.
2. **Agent cannot widen SL.** Only narrow. Never remove.
3. **Agent cannot disable stop-writer authority** (`isAuthorizedBinanceNativeStopWriter`).
4. **Every agent decision writes an Evidence record** before execution.
5. **Narrative reasoner runs with timeout** (`OPENCLAW_NARRATIVE_TIMEOUT_MS` default 5000).
   On timeout → rule-based fallback, confidence 0, log.
6. **Shadow first**. Every new agent capability ships behind
   `OPENCLAW_AGENT_*_SHADOW_ONLY=1` env; production enable requires
   explicit flip plus roadmap entry.
7. **Evidence-based auto-degrade**. If an agent source's realized
   calibration error > 30% over 50 decisions, it is auto-demoted and
   the failure is paged.
8. **One-way ratchet on safety**. The agent can always propose tighter
   stops / smaller qty / skip. It can never propose looser stops or bigger
   qty without rule-based concurrence.

---

## 5. Phased rollout (buildable)

### Phase A — scaffolding + evidence (this PR)
- Create `openclawDecisionAgent.js` — a shell that today just forwards
  to the existing executor. This is the future entry point.
- Create `openclawEvidenceLedger.js` + `src/storage/openclawEvidenceLedger.js`
  — writes evidence records (start / decision / outcome-linker hook).
- Create `openclawNarrativeReasoner.js` — LLM adapter stub with prompt
  templates; **NO live calls yet** (env gate default off).
- Env knobs: `OPENCLAW_AGENT_ENABLED`, `OPENCLAW_NARRATIVE_ENABLED`,
  `OPENCLAW_NARRATIVE_SHADOW_ONLY`, etc.
- All tests pass; production code path is **unchanged** because agent is
  off by default.

### Phase B — ML soft-gate (1 week)
- Connect `liveInferenceRouter` to emit a per-market TP1 probability
  into the composite.
- Evidence outcome linker starts running (cron).
- Calibration report `report-openclaw-calibration.js` starts measuring
  per-source realized accuracy.

### Phase C — Narrative reasoner in shadow (2 weeks)
- Enable LLM call in shadow mode — the agent records what it
  *would* have decided, but does not affect execution.
- Build side-by-side report: rule decision vs rule+narrative decision,
  per market.
- Require 2 weeks of agreement rate + at-least-break-even realized
  performance before moving forward.

### Phase D — Veto-and-scale narrative (2 weeks)
- Narrative gains veto (can reduce qty to 0) but cannot amplify.
- Position Conductor in shadow (simulates tighter-stop proposals).
- Retrospect loop in shadow (runs every 4h, writes recommendations).

### Phase E — Full agent autonomy (1 month)
- Narrative full weight (bounded by trust calibration).
- Conductor can act (tighter stops only).
- Retrospect auto-applies high-confidence parameter drift with manual
  weekly reversal right.

---

## 6. Interface sketch

```js
// src/services/openclawDecisionAgent.js
async function decideOnSignal({
  exchange, symbol, intent, qtyPct, features, stage, signalTf,
}) {
  const ruleVote = await evaluateOpenClawExecutionAuthority({ ... });
  const mlVote = OPENCLAW_ML_GATE_ENABLED
    ? await scoreTp1Probability({ market: symbol, features })
    : null;
  const narrativeVote = OPENCLAW_NARRATIVE_ENABLED
    ? await reasonAboutSignal({ symbol, features, ruleVote, mlVote, timeoutMs })
    : null;
  const composite = combineVotes({ ruleVote, mlVote, narrativeVote, trustWeights });
  await writeEvidenceRecord({ kind: "SIGNAL_DECIDER", inputs, predictions, composite });
  return composite;
}

async function conductPosition({ exchange, symbol, positionSnapshot, ticks }) {
  // NEVER widens SL. Can only propose tighter stops or earlier TP1.
  const proposal = await reasonAboutPosition({ positionSnapshot, ticks });
  const bounded = clampProposalToSafetyRails(proposal, positionSnapshot);
  await writeEvidenceRecord({ kind: "POSITION_CONDUCTOR", ... });
  return bounded;
}

async function runRetrospect({ lookbackHours = 24, sampleN = 50 }) {
  const trades = await loadRecentRealizedTrades({ lookbackHours, sampleN });
  const patterns = await reasonAboutFailurePatterns({ trades });
  await writeEvidenceRecord({ kind: "RETROSPECT", ... });
  await writeRetrospectArtifact(patterns);
  return patterns;
}
```

---

## 7. What changes for the operator

- Today the operator tunes SL/TP1 via config. Tomorrow the operator sets
  **trust weights** and **safety rails**; the agent tunes SL/TP1 per
  position.
- Today the operator reads the drop-reason chip. Tomorrow the operator
  reads the **Evidence Ledger calibration card** showing where each
  decision source is reliable.
- Today the retrospective is manual (the operator reads trades and
  thinks). Tomorrow the retrospective runs every 4h and hands the
  operator a concrete "apply / reject / shadow-more" dashboard.

---

## 8. What we ship in THIS PR

1. **Design document** — this file.
2. **Agent shell** — `openclawDecisionAgent.js` callable but no-op in
   production (feature flag gated; falls through to existing flow).
3. **Evidence Ledger** — in-memory + Firestore writer with a schema
   contract test.
4. **Narrative reasoner stub** — module loaded but LLM call gated behind
   `OPENCLAW_NARRATIVE_ENABLED=0` (default).
5. **Shadow hook** — single line in `webhook.routes.js` that calls the
   agent and compares to the existing flow WHEN
   `OPENCLAW_AGENT_SHADOW_ENABLED=1` (default 0).
6. **Tests** — contract tests for:
   - Agent forwards to existing executor when disabled.
   - Shadow mode never changes production outcome.
   - Evidence Ledger records well-formed records.
   - Safety rails clamp overreaches.

This is safely shippable — the production decision path is unchanged by
default. Every subsequent phase (B..E) is a separate PR.
