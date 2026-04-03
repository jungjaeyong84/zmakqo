# CLAUDE_CURRENT_STATE_HANDOFF_PROMPT_2026-04-03

Use the prompt below when handing the current donbeolja state to Claude.

```md
Audit and explain the current donbeolja system state using latest artifacts first, then code only when needed.

Assume the current primary execution path is `SERVER_PRIMARY`. Treat Pine only as shadow/legacy-compatibility context unless an artifact explicitly shows otherwise.

Read in this exact order:
1. /Users/jeongjaeyong/Projects/donbeolja/docs/CURRENT_SYSTEM_STATUS_2026-04-03.md
2. /Users/jeongjaeyong/Projects/donbeolja/docs/DONBEOLJA_SYSTEM_SSOT_FOR_REVIEW_2026-04-03.md
3. /Users/jeongjaeyong/Projects/donbeolja/docs/OPENCLAW_SYSTEM_REVIEW_RUNBOOK_2026-04-03.md
4. /Users/jeongjaeyong/Projects/donbeolja/docs/OPENCLAW_AUTONOMY_CONTRACT.md
5. /Users/jeongjaeyong/Projects/donbeolja/docs/SERVER_SIGNAL_AUTHORITY_SPEC.md
6. /Users/jeongjaeyong/Projects/donbeolja/openclaw-workspace/MEMORY.md
7. /Users/jeongjaeyong/Projects/donbeolja/openclaw-ops-workspace/MEMORY.md
8. latest artifacts under /Users/jeongjaeyong/Projects/donbeolja/ops/daily
   - include `server_signal_runtime_latest.json`
   - include `server_signal_cutover_readiness_latest.json`
   - include `server_signal_quality_latest.json`
   - include `automation_watchdog_latest.json`
   - include `best_self_evolution_reasoning_journal_latest.json`
   - include `best_self_evolution_openclaw_autonomy_parity_latest.json`
   - include `best_self_evolution_other_server_policy_review_latest.json`
   - include `best_self_evolution_family_scoreboard_latest.json`
9. code only when you need to explain why the current artifact state exists

Current context you must preserve:
- server canonical execution is active
- Pine is shadow-only and not the primary execution path
- OpenClaw automation is healthy
- objective supervisor is still HOLD
- autonomy authority is still PENDING
- learning_epoch_exception_release=true is active
- reasoning journal compaction is active
- reasoning journal verification outcome resolution is active
- autonomy parity tracking is active
- contextual deep-dive/remediation steps are declared through a capability manifest
- OTHER_SERVER_POLICY has its own dedicated review artifact and capability
- family scoreboard tracking is active
- historical market-level exception blocks were intentionally released to collect fresh server-native data
- do not call released historical exceptions a regression by default
- do not infer full autonomy from healthy automation alone
- separate source parity mismatch from final downstream mismatch
- separate `SERVER_PRIMARY_ACTIVE`, `promotion_gate_status`, and `promotion_ready`
- distinguish the latest aligned cutover/runtime/quality cycle from lagging autonomy/family artifacts

Current operating facts you must verify from latest artifacts:
- automation_watchdog_latest -> PASS
- server_signal_runtime_latest -> READY
- server_signal_runtime_latest -> canonical_engine_source_mode=SERVER_PRIMARY
- server_signal_cutover_readiness_latest -> SERVER_PRIMARY_ACTIVE
- server_signal_cutover_readiness_latest -> promotion_gate_status=READY
- server_signal_cutover_readiness_latest -> artifact_coherence_status=READY
- server_signal_quality_latest -> WATCH_PARITY_DRIFT
- server_signal_quality_latest -> final_downstream_mismatch_n=17
- server_signal_observation_24h_latest -> learning_epoch_exception_release=true
- server_signal_drift_remediation_apply_latest -> effective other_server_policy_watch_only_markets=[]
- objective_supervisor_latest -> HOLD
- best_self_evolution_openclaw_autonomy_contract_latest -> authority_state=PENDING
- best_self_evolution_reasoning_journal_latest -> compacted_context present
- best_self_evolution_reasoning_journal_latest -> verification stats present (`verified_n`, `not_met_n`, `unknown_n`, `verification_rate`)
- best_self_evolution_openclaw_autonomy_parity_latest -> progress tracked by requirement rows
- best_self_evolution_openclaw_autonomy_parity_latest -> includes `reasoning_verification_quality`
- /Users/jeongjaeyong/Projects/donbeolja/ops/manifests/openclaw-evolution-capabilities.json -> contextual capabilities registry
- best_self_evolution_other_server_policy_review_latest -> top OTHER_SERVER_POLICY sub-reason and verification target
- best_self_evolution_family_scoreboard_latest -> family-to-capability mapping and priority status

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
6. If cutover/runtime/quality are aligned on a newer cycle than autonomy/family artifacts, state that explicitly instead of flattening them into one current-state claim.

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
