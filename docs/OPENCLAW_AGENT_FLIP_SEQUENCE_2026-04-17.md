# OpenClaw Decision Agent — Operator Flip Sequence (2026-04-17)

Runbook for activating the OpenClaw ML+AI Decision Agent in production,
phase by phase. The host machine is expected to have the `claude` CLI
already installed and authenticated (the operator's local workstation);
the server side uses the same binary.

Every step is **reversible via a single env delete + process restart**.
Every step expects 3–7 days of observation before advancing.

---

## Pre-flight (once)

```
# 1. Confirm the Claude CLI is installed on every host that runs the
#    trading service.
which claude                          # must print a binary path
claude --help | head -3                # must print version banner

# 2. Install the default env at ~/.env.openclaw (never commit this file)
cat > ~/.env.openclaw <<'EOF'
OPENCLAW_CLAUDE_CLI_BIN=/Users/jeongjaeyong/.local/bin/claude
OPENCLAW_CLAUDE_CLI_MODEL=sonnet
OPENCLAW_CLAUDE_CLI_TIMEOUT_MS=8000
OPENCLAW_NARRATIVE_PROVIDER_MODE=CLI
OPENCLAW_NARRATIVE_SHADOW_ONLY=1
EOF

# 3. Ensure the evidence ledger collection exists in Firestore (it will
#    be created lazily on first write, but verify the rules allow the
#    service account to write to `openclaw_evidence_ledger`).

# 4. Run the full test suite locally as a sanity check.
cd ~/Projects/donbeolja
npm test
```

---

## Step 1 — Enable agent in shadow (Day 0)

Purpose: start populating the Evidence Ledger without changing any trade.

```
# env (set on the Cloud Run service and on the local dev host)
OPENCLAW_AGENT_SHADOW_ENABLED=1
OPENCLAW_EVIDENCE_LEDGER_FIRESTORE=1
```

Verify (3 hours later):
```
# records should be accumulating
gcloud firestore query --project donbeolja \
  "SELECT decision_id, kind, at FROM openclaw_evidence_ledger \
   WHERE at >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 3 HOUR) \
   LIMIT 5"
```

Rollback: `unset OPENCLAW_AGENT_SHADOW_ENABLED` → production flow
identical to pre-PR state.

---

## Step 2 — Enable ML soft-gate in shadow (Day 1)

Still no trade mutation. The ML gate writes its vote into evidence, but
composite is only rendered into the shadow record.

```
OPENCLAW_ML_GATE_ENABLED=1
OPENCLAW_ML_MIN_TP1_PROB=0.22
```

Observation target (48h): shadow `ml.accept=false` rate should roughly
mirror the drop-validation family's own rejection rate on the live
cohort. If it blocks too hard, raise `OPENCLAW_ML_MIN_TP1_PROB` in
steps of 0.02.

---

## Step 3 — Add the outcome-linker + calibration cron (Day 1)

`ops/launchd/openclaw_cron.sh` (or the host's crontab):

```
# every 15 minutes — link evidence to realized fills
*/15 * * * *   cd /path/to/donbeolja && DRY_RUN=0 node scripts/link-openclaw-evidence-outcomes.js >> /var/log/openclaw-linker.log 2>&1

# every 4 hours — re-score trust weights
0 */4 * * *    cd /path/to/donbeolja && node scripts/report-openclaw-calibration.js >> /var/log/openclaw-calibration.log 2>&1
```

Observation target (7 days): `ops/daily/openclaw_calibration_latest.json`
has `linked_n >= 20` for every source.  Only then are Phase C/D
migrations statistically meaningful.

---

## Step 4 — Enable narrative reasoner in shadow via Claude CLI (Day 7)

```
OPENCLAW_NARRATIVE_ENABLED=1
OPENCLAW_NARRATIVE_LIVE_CALL_ENABLED=1
OPENCLAW_NARRATIVE_PROVIDER_MODE=CLI       # default
OPENCLAW_NARRATIVE_SHADOW_ONLY=1           # narrative cannot mutate
OPENCLAW_CLAUDE_CLI_MODEL=sonnet           # cost-sensitive default
```

Observation target (7 days):
- `narrative.live_failed=true` rate < 5% (mostly timeouts — keep)
- narrative accept-agreement with rule engine > 70%
- narrative scale-reduce firing rate on overexposed markets > 20%

Cost monitor: each call is logged with `cost_usd`. At 50 signals/hour
× 3 calls (signal+conductor+retrospect) × ~$0.008/call ≈ $29/day
cap. Set `OPENCLAW_CLAUDE_CLI_MODEL=haiku` for 5× cheaper tier when
shadow run shows agreement is similar.

Rollback: `unset OPENCLAW_NARRATIVE_LIVE_CALL_ENABLED` keeps
everything else but stops the CLI subprocess cost.

---

## Step 5 — Enable position conductor in shadow (Day 10)

```
OPENCLAW_CONDUCTOR_ENABLED=1
OPENCLAW_CONDUCTOR_SHADOW_ONLY=1           # no stop mutation yet
```

Add a cron to drive per-position ticks:
```
* * * * *   cd /path/to/donbeolja && node -e "require('./src/services/openclawPositionConductor').proposeAdjustment({...})"
```

(Or — more likely — call `proposeAdjustment` from the existing tick-exit
loop, guarded by `OPENCLAW_CONDUCTOR_ENABLED`. That integration is a
separate PR; Phase D intentionally ships only the proposer.)

Observation target (7 days):
- zero `TIGHTEN_SL_NOT_TIGHTER_*` safety-rail hits (means conductor
  isn't trying to widen)
- `apply_ready=false` for every record (still shadow)

---

## Step 6 — Start the retrospect loop cron (Day 10)

```
# every 4 hours — review the last 24h trades
0 */4 * * *   cd /path/to/donbeolja && node scripts/run-openclaw-retrospect.js >> /var/log/openclaw-retrospect.log 2>&1
```

Output: `ops/daily/openclaw_retrospect_latest.json`.

Operator action: at least weekly, review `proposals[]`. Risk-reducing
proposals (tighter / smaller / skip_regime) that you agree with → flip
corresponding policy env (e.g. `OPERATOR_OVERRIDES` market_qty_scales
for a given market). Never auto-apply retrospect — keep human in loop.

---

## Step 7 — Flip apply on (Day 14)

```
OPENCLAW_AGENT_APPLY_ENABLED=1
# narrative can now reduce qty; conductor proposals still not applied
```

Observation target (3 days): realized per-position qty should show the
narrative's scale reductions firing on the expected markets. PnL per
trade should NOT be worse than the shadow baseline (composite can only
reduce qty; in the worst case it matches rule decision).

---

## Step 8 — Flip conductor apply on (Day 17)

```
unset OPENCLAW_CONDUCTOR_SHADOW_ONLY      # default becomes 1 → so also explicitly:
OPENCLAW_CONDUCTOR_SHADOW_ONLY=0
```

Conductor now mutates SL when proposal is `tighten_sl` + passes safety
rail. Observe for 5 days.

---

## Step 9 — Enable autonomy auto-degrade (Day 22)

```
OPENCLAW_AGENT_AUTONOMY_ENABLED=1
OPENCLAW_AGENT_AUTONOMY_TRUST_FLOOR=0.3
```

The calibration report drives per-source trust. When a source's realized
TP1 hit rate < 0.3 on ≥ 20 samples, it is auto-demoted (its vote is
dropped). Monitor:
```
jq '.recommendations[] | select(.severity=="HIGH")' ops/daily/openclaw_calibration_latest.json
```

---

## Tripwires — any of these means STOP immediately

| Condition | Action |
|---|---|
| `LEDGER_INVARIANT_VIOLATION` non-zero | `unset OPENCLAW_AGENT_APPLY_ENABLED` and investigate |
| Per-source realized TP1 rate < 0.15 over 50 samples | auto-demote should have caught it; if not, file bug |
| CLI cost/day > $50 | tune model (haiku), timeout, or frequency |
| Any safety-rail violation count > 0/day | widen/increase_qty attempted — operator alert |
| Realized win rate drops > 10 pp from shadow baseline | revert Step 7 |

---

## Long-term
- After 90 days: migrate from `openclaw_evidence_ledger` rolling window
  to a curated training corpus for a dedicated per-market ML model.
- Consider `gpt-5.x` as a second-opinion reasoner (provider_mode=API with
  OpenAI key). Current code supports this via the API fallback.
