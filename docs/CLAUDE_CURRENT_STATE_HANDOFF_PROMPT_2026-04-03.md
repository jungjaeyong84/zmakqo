# CLAUDE_CURRENT_STATE_HANDOFF_PROMPT_2026-04-03

Use the prompt below when handing the current donbeolja state to Claude.

```md
Audit and explain the current donbeolja system state using latest artifacts first, then code only when needed.

Read in this exact order:
1. /Users/jeongjaeyong/Projects/donbeolja/docs/CURRENT_SYSTEM_STATUS_2026-04-03.md
2. /Users/jeongjaeyong/Projects/donbeolja/docs/DONBEOLJA_SYSTEM_SSOT_FOR_REVIEW_2026-04-03.md
3. /Users/jeongjaeyong/Projects/donbeolja/docs/OPENCLAW_SYSTEM_REVIEW_RUNBOOK_2026-04-03.md
4. /Users/jeongjaeyong/Projects/donbeolja/openclaw-workspace/MEMORY.md
5. /Users/jeongjaeyong/Projects/donbeolja/openclaw-ops-workspace/MEMORY.md
6. latest artifacts under /Users/jeongjaeyong/Projects/donbeolja/ops/daily
   - include `best_self_evolution_reasoning_journal_latest.json`
   - include `best_self_evolution_openclaw_autonomy_parity_latest.json`
7. code only when you need to explain why the current artifact state exists

Current context you must preserve:
- server canonical execution is active
- Pine is shadow-only
- OpenClaw automation is healthy
- objective supervisor is still HOLD
- autonomy authority is still PENDING
- learning_epoch_exception_release=true is active
- reasoning journal compaction is now active
- reasoning journal verification outcome resolution is now active
- autonomy parity tracking is now active
- contextual deep-dive/remediation steps are now declared through a capability manifest
- historical market-level exception blocks were intentionally released to collect fresh server-native data
- do not call released historical exceptions a regression by default
- do not infer full autonomy from healthy automation alone
- separate source parity mismatch from final downstream mismatch

Current operating facts you must verify from latest artifacts:
- automation_watchdog_latest -> PASS
- openclaw_hourly_cycle_latest -> PASS
- server_signal_runtime_latest -> READY
- server_signal_cutover_readiness_latest -> SERVER_PRIMARY_ACTIVE
- server_signal_quality_latest -> WATCH_PARITY_DRIFT
- server_signal_observation_24h_latest -> learning_epoch_exception_release=true
- server_signal_drift_remediation_apply_latest -> effective other_server_policy_watch_only_markets=[]
- objective_supervisor_latest -> HOLD
- best_self_evolution_openclaw_autonomy_contract_latest -> authority_state=PENDING
- best_self_evolution_reasoning_journal_latest -> compacted_context present
- best_self_evolution_reasoning_journal_latest -> verification stats present (`verified_n`, `not_met_n`, `unknown_n`, `verification_rate`)
- best_self_evolution_openclaw_autonomy_parity_latest -> progress tracked by requirement rows
- best_self_evolution_openclaw_autonomy_parity_latest -> includes `reasoning_verification_quality`
- /Users/jeongjaeyong/Projects/donbeolja/ops/manifests/openclaw-evolution-capabilities.json -> contextual capabilities registry

Interpretation rules:
1. Prefer latest artifacts over narrative or old retrospectives.
2. Treat learning_epoch_exception_release=true as intentional fresh-data collection policy.
3. Do not recommend reapplying market-level blocks solely because they existed in older artifacts.
4. Distinguish:
   - structural implementation
   - current artifact evidence
   - operational hold
   - intentional temporary policy
5. Do not call “all data fully learned” unless you can show that raw execution data is directly consumed as the current decision source rather than summarized artifacts.

Return your answer in this format:

1. Current Facts
2. Findings
   - P1, P2, P3 only
   - each finding must include:
     - what is wrong
     - why it matters
     - exact absolute file path
     - current value
3. Contradictions
   - doc vs artifact
   - artifact vs artifact
   - code vs artifact
4. Risk Interpretation
   - clarify whether learning-epoch exception release is intentional policy or a bug
   - clarify what is still truly blocked
5. Final Verdict
   - ARCHITECTURE
   - OPERATIONS
   - AUTONOMY
   - OPENCLAW_AUTOMATION
   - SERVER_SIGNAL_RUNTIME
   - TELEGRAM_DELIVERY
6. Next Actions

Constraints:
- absolute file paths only
- findings first, evidence first
- no stale narrative reuse
- if latest artifacts and old docs disagree, latest artifacts win
```
