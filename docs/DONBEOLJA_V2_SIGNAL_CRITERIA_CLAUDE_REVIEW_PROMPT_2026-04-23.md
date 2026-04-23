# Claude Review Prompt

You are reviewing a crypto trading system as a senior quant reviewer with 30+ years of systematic trading, execution, and production risk experience.

Repository root:

- `/Users/jeongjaeyong/Projects/donbeolja`

Review target:

- V2 server-native signal criteria
- V2 performance gate stage thresholds
- V2 discovery canary decision table

Primary files:

- [signalCriteria.js](/Users/jeongjaeyong/Projects/donbeolja/src/v2/signalCriteria.js)
- [signalRegimeProfile.js](/Users/jeongjaeyong/Projects/donbeolja/src/v2/signalRegimeProfile.js)
- [expectedEdgeModel.js](/Users/jeongjaeyong/Projects/donbeolja/src/v2/expectedEdgeModel.js)
- [openclawControlPlane.js](/Users/jeongjaeyong/Projects/donbeolja/src/v2/openclawControlPlane.js)
- [signalAuthorityRouter.js](/Users/jeongjaeyong/Projects/donbeolja/src/v2/signalAuthorityRouter.js)
- [mlAiSignalProposal.js](/Users/jeongjaeyong/Projects/donbeolja/src/v2/mlAiSignalProposal.js)
- [openclawOutcomeAdjudicator.js](/Users/jeongjaeyong/Projects/donbeolja/src/v2/openclawOutcomeAdjudicator.js)
- [openclawDailyPerformanceReport.js](/Users/jeongjaeyong/Projects/donbeolja/src/v2/openclawDailyPerformanceReport.js)
- [signalCohortReport.js](/Users/jeongjaeyong/Projects/donbeolja/src/v2/signalCohortReport.js)
- [performanceGate.js](/Users/jeongjaeyong/Projects/donbeolja/src/v2/performanceGate.js)
- [check-v2-performance-gate.js](/Users/jeongjaeyong/Projects/donbeolja/scripts/check-v2-performance-gate.js)
- [discoveryCanaryContract.js](/Users/jeongjaeyong/Projects/donbeolja/src/v2/discoveryCanaryContract.js)
- [run-v2-discovery-canary-preflight-deploy.js](/Users/jeongjaeyong/Projects/donbeolja/scripts/run-v2-discovery-canary-preflight-deploy.js)
- [DONBEOLJA_V2_SIGNAL_CRITERIA_SPEC_2026-04-23.md](/Users/jeongjaeyong/Projects/donbeolja/docs/DONBEOLJA_V2_SIGNAL_CRITERIA_SPEC_2026-04-23.md)

Review goals:

1. Determine whether the V2 signal criteria are economically coherent.
2. Determine whether the signal criteria are production-safe.
3. Determine whether the performance stage thresholds are reasonable for:
   - discovery
   - canary
   - live
4. Determine whether discovery canary preflight and performance matrix are connected in a defensible way.
5. Identify any remaining places where V2 could quietly trade low-edge setups or falsely promote a weak strategy.

What to inspect closely:

1. Signal criteria structure
   - Does `no_trade -> regime -> setup -> trigger -> expected_edge` make sense?
   - Are there obvious missing blocker families?
   - Are the thresholds plausible as starting values rather than optimization claims?

2. Hard gate enforcement
   - Is `signal_criteria.verdict !== PASS` guaranteed to block server-native ML entry?
   - Is the signal criteria payload included in the OpenClaw decision bundle and ledger path?
   - Does missing evidence fail closed, or can the runtime synthesize passing defaults?

3. Expected edge logic
   - Is `expected_net_r_after_cost` treated as a real blocker?
   - Are cost-aware signals meaningfully separated from direction-only signals?
   - Is `gross_r / cost_r_equivalent / net_r_after_cost` internally consistent?
   - Does the derived `expected_edge_model` make coherent use of setup/trigger/market/regime evidence?

4. Regime profile and cohort lineage
   - Does the runtime classify regime in a way that is usable for cohort analysis without silently weakening the hard gates?
   - Are `structural_regime`, `regime_cohort`, and `edge_cohort` carried from bundle into outcome evidence and daily performance reporting?
   - Can the performance report identify which setup/regime cohorts are actually producing wins or losses?

5. Performance stage table
   - Are the three stages internally consistent?
   - Do the thresholds look too lenient or too strict for:
     - sample count
     - win rate
     - profit factor
     - expectancy
     - drawdown
   - Is the drawdown policy monotonic across DISCOVERY -> CANARY -> LIVE?

6. Discovery canary
   - Does the runtime preflight remain fail-closed?
   - Is the performance stage matrix surfaced cleanly without weakening the canary gate?

Required output format:

1. `총평`
2. `대표 판정`
3. `점수표`
4. `발견 사항`
   - severity
   - title
   - evidence
   - impact
   - root cause
   - recommendation
5. `V1 약점 재발 여부`
6. `OpenClaw 폐루프 평가`
7. `Entry/Exit/Trailing 불변식`
8. `테스트 커버리지 갭`
9. `LIVE 전 필수 체크리스트`
10. `최종 권고`

Review standard:

- Be adversarial about silent failure.
- Prefer structural objections over stylistic comments.
- Distinguish clearly between:
  - code-level defect
  - threshold disagreement
  - operating evidence gap
- If thresholds are acceptable as seed values but not as proven live values, say so explicitly.

Important framing:

- Treat this as a `production-grade baseline signal contract`, not a claim of optimized alpha.
- Treat missing evidence as a first-class safety defect, not a threshold disagreement.
- Do not confuse:
  - `safe to test`
  - `safe to scale`
  - `proven profitable live`

The review should answer one central question:

> Is this V2 signal criteria framework a defensible starting contract for discovery/canary operation, and if not, exactly where does it fail?
