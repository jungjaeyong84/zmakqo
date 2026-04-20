# Follow-up tasks

Ops-owned follow-ups that were deliberately scoped OUT of a merged PR
to keep the change small, but which must be closed before the
associated invariant is considered hardened.  Each entry lists the
source PR, the follow-up action, and a trigger / deadline.

---

## 2026-04-20 senior-audit sweep (PR #21 + PR #22)

### 1. Tighten `NATIVE_PROTECTION_UNPROTECTED_WINDOW_THRESHOLD_MS` default

- **Source**: PR #21 introduced the P2 unprotected-window sub-gate with a
  `DEFAULT_THRESHOLD_MS = 3000` (3 s).  That value is intentionally
  generous to avoid false positives during rollout when the baseline p99
  for `refreshBinanceNativeProtection` cancel→ack is not yet known.
- **Action**: after ~2 weeks of stable gate runs, inspect
  `ops/daily/native_protection_unprotected_window_latest.json` p95 /
  p99 `window_ms` across at least 200 healthy refreshes.  Retune
  `DEFAULT_THRESHOLD_MS` in
  `src/services/nativeProtectionUnprotectedWindowRuntime.js` to
  `p99 × 1.5` (or 1200 ms, whichever is larger).  Update the
  accompanying comment to reflect the new baseline.
- **Trigger**: ≥ 2 weeks of stable prod runs after PR #21 ships, OR
  2026-05-04, whichever comes first.
- **Owner**: exit-integrity gate owner.
- **Open**.

### 2. Validate H1 production startup guard in a real deploy

- **Source**: PR #22 adds a `NODE_ENV=production` startup guard in
  `src/utils/egressProxy.js` that throws when
  `EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER=1`.  The guard is unit-tested
  but the real safety comes from exercising it against a Cloud Run
  service whose env is mis-set.
- **Action**: after PR #22 lands and a normal deploy succeeds, run a
  *staged* canary where the Cloud Run service env explicitly includes
  `EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER=1` and confirm the container
  crash-loops with the expected startup error (not a soft log line).
  Then revert to production env and confirm the revision serves
  traffic again.
- **Trigger**: one-time validation, within 2 days of PR #22 merge.
- **Owner**: exit-worker deploy owner.
- **Open**.

### 3. Close the P5 canonical writer duplication (deferred)

- **Source**: multiple PRs referenced a dual canonical writer between
  `paperBinanceRunner.js` and `tradeExecutionAlert.js`.  P5 was
  explicitly excluded from PR #21 because the refactor surface is
  large.
- **Action**: plan a dedicated PR that consolidates canonical-exit
  writes to a single writer, with the other side demoted to a
  read-only consumer.  Include a regression test that asserts a
  single-writer invariant (e.g. by counting Firestore writes per
  exit-event id in a replay).
- **Trigger**: before any further canonical-exit schema change.
- **Owner**: exit-integrity architect.
- **Open**.
