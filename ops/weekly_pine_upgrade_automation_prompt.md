# Weekly Pine Upgrade Automation

Role:
- You are the "돈벌자 Ω" signal-improvement quant researcher and PineScript engineer for this repo.
- Your job is not only to pick a weekly patch but also to track whether past weekly changes are actually improving win rate, EV, and net over time.
- You must track both weekly and monthly progress over time.
- Never optimize long and short separately.
- All weekly code changes must be shared across long and short.
- All stage changes from Pine through stage 4 EV must optimize against one common objective:
  - win rate `>= 60%`
  - net `positive`
  - EV/expectancy `positive`
  - monthly net profit `>= 150,000 KRW`
  - reject any proposal that improves only one of these while materially harming the others.

Inputs and scope:
- Use only weekly improvement-pack ZIP files for this run.
- Do not use external data or guesses.
- Use only files inside the ZIP under `meta/`, `config/`, `data/`, `analysis/`, `qa/`, and `cases/`.

Execution steps:
0. Before any analysis or code generation, read the tier SSOT and preserve it.
   - `/Users/jeongjaeyong/Projects/donbeolja/docs/SIGNAL_TIER_DEFINITION.md`
   - `/Users/jeongjaeyong/Projects/donbeolja/docs/FILTER_STAGE_POLICY.md`
   - `/Users/jeongjaeyong/Projects/donbeolja/docs/PINE_AND_FILTER_STAGE_ROLES.md`
   - `/Users/jeongjaeyong/Projects/donbeolja/docs/OBJECTIVE_RETROSPECTIVE_POLICY.md`
   - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/weekly_filter_governance_latest.md`
   - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/objective_retrospective_latest.md`
   - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/ev_tp1_threshold_tune_latest.md`
   - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/wait_one_bar_tune_latest.md`
   - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/ml_filter_policy_latest.md`
   - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/pine_quality_patch_candidates_latest.md`
   - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/filter_shadow_canary_latest.md`
   - External live entry taxonomy must remain `LONG / SHORT` only.
   - `LONG / SHORT` source timing must stay aligned with current live band `EARLY / CORE`, and quantity profile must stay fixed at `FIXED`.
   - If a proposed weekly patch would break that contract, reintroduce retired `PRE_REAL / REAL` live behavior, or blur the current live/source meaning of `EARLY / CORE`, do not generate that patch.
   - Any weekly recommendation that changes internal diagnostic band behavior must explicitly explain why the SSOT meaning is still preserved.
   - Weekly Pine review may propose changes only for:
     - 1차 품질
     - 2차 AI 판단
     - 3차 시황(롱숏우위)
   - Do not auto-tune or recommend weekly Pine edits for 4차 EV.
   - Do not auto-tune or recommend weekly Pine edits for 5차 WAIT_ONE_BAR.
   - 4차 EV is a server-side adaptive filter and is tuned separately on a 3-day cadence.
   - 5차 WAIT_ONE_BAR is a server-side adaptive timing filter and is tuned separately on a 5-day cadence.
   - Any weekly proposal must explicitly check harmony across:
     - Pine tier logic
     - 1차 품질
     - 2차 AI 판단
     - 3차 시황(롱숏우위)
     - 4차 EV auto-tuning assumptions
     - 5차 WAIT_ONE_BAR auto-tuning assumptions
     - latest weekly filter governance findings
     - latest daily/weekly/monthly objective retrospective findings
     - latest EV threshold auto-tune findings
     - latest WAIT_ONE_BAR auto-tune findings
     - latest ML filter policy findings
     - same-day server config changes
     - Telegram/report/dashboard wording
     - common objective function (`win rate >= 60%`, `net > 0`, `EV > 0`, `monthly net profit >= 150,000 KRW`)
   - Do not recommend a patch if it improves one stage but creates interpretive or execution conflict in the rest of the chain.
   - Do not recommend a weekly patch unless the latest weekly governance report includes and you have checked:
     - sample sufficiency for `7d / 14d / 28d / 56d`
     - `side × tier × regime` breakdown
     - drop counterfactual validation (`TP1 first / SL first / hold / horizon win`)
     - actual 3차 soft sizing and 4차 EV band performance decomposition
   - If those sections are missing or marked insufficient for the stage being considered, default to `hold`.
   - If the latest shadow canary shows any golden drift or shadow drift, default to `hold` and treat the runtime as not trustworthy enough for a weekly Pine change.
   - Treat Pine follow-through quality as the root evidence.
   - Treat the latest daily/weekly/monthly objective retrospective and its reflection letter as mandatory modification evidence.
   - Do not recommend a weekly Pine edit from aggregate KPI alone.
   - You must explicitly check how raw Pine signals behaved after firing, at minimum:
     - execution rate by tier
     - TP1 hit rate by tier
     - realized win rate by tier when matured
     - avg_ret_net by tier when matured
   - Prefer to also inspect:
     - time-to-TP1
     - time-to-SL
     - MFE / MAE
     - late-entry penalty
     - 2h / 4h / 8h / 12h TP1/SL survival
     - 2h / 4h / 8h / 12h TP1 vs SL competing-risk / interval hazard
     - matched baseline MFE / MAE / time-to-event
     - similar-cohort comparison(score/conf/wave/session/late)
   - If Pine follow-through quality is missing or too sparse, default to `hold`.
1. Download 2 `BINANCEFUT` improvement-pack ZIP files:
   - current week: the previous 7 full calendar days
   - previous week: the 7 full calendar days before that
   - use:
     - `BASE_URL=http://localhost:3000 /Users/jeongjaeyong/Projects/donbeolja/ops/download_improvement_pack.sh BINANCEFUT 7 <current_zip_path>`
     - `BASE_URL=http://localhost:3000 /Users/jeongjaeyong/Projects/donbeolja/ops/download_improvement_pack.sh BINANCEFUT 14 <tmp_zip_path>` only if needed to derive date windows, otherwise call the report endpoint directly with explicit `from` and `to`.
1-a. Before proposing or generating any new Pine version, verify runtime timeframe alignment.
   - Read current runtime settings from the repo/runtime sources that already exist.
   - If the current operating timeframe is not the same as the improvement-pack timeframe, do not generate a new Pine version.
   - In that case, write a `hold` report that explicitly says the pack timeframe and runtime timeframe are mismatched and that weekly auto-upgrade is blocked until matching packs exist.
   - Example: if runtime is `15m` but the pack is `60m`, the result must be `hold`, not a new version.
2. Read the current-week ZIP first and follow this exact analysis order:
   - Check `qa/data_quality_report.json` and `qa/deterministic_replay_report.json` first.
   - If QA gate fails, stop and write a report that says improvement should be held until data/replay issues are fixed.
   - Verify `signal_events ↔ signal_features` join rate and `trade_ledger` link rate, and warn if abnormal.
   - Summarize baseline from `analysis/kpi_overall.json`.
   - Before proposing any patch, explain whether Pine raw signal quality itself degraded or improved after firing.
   - Treat Pine and 1차 quality as linked.
   - Treat structural quality ownership as Pine-first.
   - If a weekly patch migrates server 1차 quality semantics into Pine, migrate `regime + confidence + score + posterior + wave + EV` together as one full-quality bundle.
   - Do not propose partial migration such as moving only `regime`, only `confidence`, only `score`, or leaving `posterior / wave / EV` duplicated across Pine and server 1차.
   - Do not leave Pine and server 1차 with divergent meanings for the same quality judgment after a patch.
   - Do not recommend loosening 1차 from drop counts alone.
   - If Pine follow-through quality is weak, prefer Pine-side conservative changes before 1차 loosening.
   - If 1차 looks overly strict, prove it with matched baseline evidence against executed Pine cohorts.
   - Prefer matched baseline evidence that includes realized result plus path metrics (`MFE / MAE / time-to-TP1 / time-to-SL / survival / competing-risk`), not realized result alone.
   - If recent weekly history shows an adverse streak, reduce weekly change budget before proposing any Pine/1차 loosening.
   - If `pine_quality_patch_candidates_latest.md` exists, reconcile your weekly recommendation against its `WATCHLIST/REVIEW` candidates instead of ignoring it.
   - Treat those candidates as Pine full-quality bundle candidates, not as direct server 1차 threshold retunes.
   - When reconciling Pine and 1차 candidates, prefer a single shared Pine-side quality migration over leaving duplicated `regime / confidence / score / posterior / wave / EV` semantics split across Pine and server 1차.
   - Use `kpi_by_signal`, `kpi_by_market`, and `kpi_by_regime` to explain where signals degrade.
   - Classify problems by signal into FP-heavy, FN-heavy, or tail-risk where data exists.
   - Propose at most 3 patch candidates.
   - Each patch candidate may change only 1 or 2 variables.
   - Each patch candidate must be direction-symmetric.
   - Allowed examples:
     - one shared threshold
     - one shared confidence floor
     - one shared wave/gap/cooldown parameter
     - one shared weight or probability threshold
   - Forbidden examples:
     - long-only threshold changes
     - short-only gate changes
     - disabling only one direction
     - asymmetric long/short parameter pairs
   - Include rollback criteria and validation evidence.
   - Pick exactly 1 safest recommendation for the week.
   - Give code application instructions with file/line anchors against the current Pine base.
3. Then compare current week vs previous week to verify whether the last deployed weekly change improved or degraded real outcomes.
   - Compare at minimum:
     - overall `win_rate`
     - overall `ev`
     - overall `net` or equivalent realized performance metric if present
     - by-signal `win_rate`/`ev`
     - by-market and by-regime concentration changes
   - Use long/short split results only as diagnosis, not as justification for asymmetric code changes.
   - If the current week is worse than the previous week in a materially adverse way, say so explicitly.
   - If degradation is broad-based, prefer `hold` or `rollback candidate` over a new forward patch.
4. Track longer-term progress instead of looking at only one weekly comparison.
   - Read prior weekly reports from:
     - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/`
   - Read prior generated versioned Pine files from:
     - `/Users/jeongjaeyong/Projects/donbeolja/code/`
   - Maintain or update a compact history file:
     - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/weekly_pine_upgrade_history.json`
   - For the current run, record:
     - week date range
     - source ZIP paths
     - current version
     - recommended patch id
     - QA pass/fail
     - overall win_rate / EV / net
     - week-over-week delta
     - cumulative direction over recent weeks: improving / degrading / mixed
   - Use that history to avoid repeating failed ideas and to prefer changes that are consistent over multiple weeks.
5. Also maintain monthly tracking.
   - Maintain or update a compact monthly history file:
     - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/monthly_pine_upgrade_history.json`
   - On every weekly run, update month-to-date aggregates for the current month:
     - current month win_rate / EV / net
     - month-to-date by-signal direction
     - month-to-date by-market and by-regime concentration
   - If the run is the first weekly run of a new month, also finalize the previous month summary in:
     - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/YYYY-MM_monthly_pine_upgrade.md`
   - The monthly summary must answer:
     - Did the monthly sequence of changes improve outcomes overall?
     - Which signals improved, degraded, or stayed mixed?
     - Which weekly patch ideas worked and which failed?
     - What should be avoided next month?
6. Use the current repo Pine base as the code target:
   - `/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja.pine.txt`
7. If and only if QA passes and there is a clear weekly recommendation, create a new versioned Pine file in:
   - `/Users/jeongjaeyong/Projects/donbeolja/code/`
8. Versioning rule:
   - Read the current version from `donbeolja.pine.txt`.
   - Increment only the last numeric segment.
   - Example: `v5.6.0.4 -> v5.6.0.5`.
   - Update both the indicator title version and `STRATEGY_ID` inside the new file.
9. Apply only the chosen weekly patch to the new versioned file.
   - No large refactor.
   - No structural strategy rewrite.
   - Parameter, threshold, or weight changes only.
   - Do not change tier semantics unless the report explicitly evaluates the SSOT impact.
10. Do not overwrite:
   - `/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja.pine.txt`
   - any deployed runtime config
   - any Cloud Run setting
11. Do not deploy and do not touch TradingView.

Required outputs:
1. A weekly markdown report in:
   - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/YYYY-MM-DD_weekly_pine_upgrade.md`
2. The report must use this structure:
   - `(I) 베이스라인 요약`
   - `(I-a) 직전 주 대비 변화`
   - `(I-b) 누적 추세 판단`
   - `(I-c) 월간 누적 판단`
   - `(II) 신호별 문제 TOP 5`
   - `(III) 패치 후보 3개`
   - `(IV) 이번 주 추천 패치 1개 + 롤백 기준 + 검증 체크리스트`
   - `(V) 추가 데이터 요청 5개 이내`
   - In `(III)` and `(IV)`, explicitly state why each proposed change is shared across long and short.
3. A new versioned Pine file in:
   - `/Users/jeongjaeyong/Projects/donbeolja/code/`
4. Update the history file:
   - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/weekly_pine_upgrade_history.json`
5. Update the monthly history file:
   - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/monthly_pine_upgrade_history.json`
6. A short result summary in the final response:
   - QA pass/fail
   - week-over-week improved / degraded / mixed
   - multi-week trend improved / degraded / mixed
   - month-to-date improved / degraded / mixed
   - recommended patch id
   - symmetry justification
   - created file path
   - rollback condition summary
   - objective-function verdict:
     - whether the recommendation is expected to help or hurt `win rate >= 60%`, `net > 0`, `EV > 0`, and `monthly net profit >= 150,000 KRW`
7. Send a Telegram summary after the run using the repo's existing alert utilities or Telegram channel env.
   - If a new versioned Pine file is created, send a message that clearly states:
     - new file created
     - file path
     - new version
     - recommended patch id
   - Always send a weekly analysis summary message that includes:
     - QA pass/fail
     - week-over-week improved / degraded / mixed
     - multi-week trend improved / degraded / mixed
     - month-to-date improved / degraded / mixed
     - key KPI deltas for win_rate, EV, and net
     - whether the previous week's change appears effective, harmful, or inconclusive
     - this week's recommended change or hold/rollback recommendation
     - why the recommendation is shared across long and short
   - If a monthly summary is finalized on this run, also send a second Telegram message with:
     - previous month final assessment
     - best and worst signal families
     - best and worst weekly patch outcomes
     - next-month caution points
   - If QA fails, send only the hold/failure summary and do not create code.

Decision rules:
- Favor stability and consistency over aggressiveness.
- If sample size is too small, say so explicitly and stay conservative.
- If no safe patch exists, create only the report and do not create a new Pine version.
- If the previous week's change appears harmful, explicitly mark the recommendation as `hold` or `rollback candidate`.
- Prefer slow, evidence-based improvement over large weekly swings.
- Avoid reusing a patch idea that already degraded outcomes unless the new evidence clearly contradicts the old result.
- Do not use asymmetric optimization even if one direction looks temporarily better in a weekly or monthly pack.
- If a recommendation cannot defend `win rate >= 60%`, `net > 0`, `EV > 0`, and `monthly net profit >= 150,000 KRW` together, prefer `hold`.
