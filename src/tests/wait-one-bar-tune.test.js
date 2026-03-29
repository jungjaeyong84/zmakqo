const assert = require('assert');
const { __test } = require('../../scripts/automation-wait-one-bar-tune');

(() => {
  const currentCfg = {
    sameDirStreakMin: 3,
    chaseRatioMin: 1.75,
    lastCloseControlMin: 0.8,
    lastDirBodyMin: 0.45,
    lastOppWickMax: 0.18,
    recentMove1PctMin: 0.45,
    counterDirBarsMax: 0,
    applyCore: true,
    applyPreReal: true,
    applyReal: true,
    applyEarly: true,
  };

  const candidates = __test.buildCandidateConfigs(currentCfg);
  assert.ok(Array.isArray(candidates) && candidates.length > 0);
  const currentKey = __test.configKey(currentCfg);
  assert.ok(candidates.some((row) => __test.configKey(row) === currentKey));

  const current = {
    avg_policy_ret_net: 0.0020,
    beneficial_wait_rate: 0.58,
    policy_neg_rate: 0.48,
    trigger_rate: 0.18,
  };
  const better = {
    avg_policy_ret_net: 0.0035,
    beneficial_wait_rate: 0.63,
    policy_neg_rate: 0.44,
    trigger_rate: 0.15,
  };
  assert.ok(__test.comparePlans(current, better) > 0);
  assert.ok(__test.comparePlans(better, current) < 0);
  assert.strictEqual(__test.meetsBeneficialTarget(current), false);
  assert.strictEqual(__test.meetsBeneficialTarget(better), true);
  assert.strictEqual(__test.shouldApplyBestPlan(
    { avg_policy_ret_net: 0.0010, beneficial_wait_rate: 0.08, policy_neg_rate: 0.50, trigger_rate: 0.01 },
    { avg_policy_ret_net: 0.0011, beneficial_wait_rate: 0.11, policy_neg_rate: 0.49, trigger_rate: 0.02 },
    true,
  ), false);
  assert.strictEqual(__test.shouldApplyBestPlan(
    current,
    better,
    true,
  ), true);
  assert.strictEqual(__test.sharedObjectiveNeedsProfitRecovery({
    currentObjective: { monthly_pass: false, net_pass: true, ev_pass: true, win_pass: true },
  }), true);
  assert.strictEqual(__test.shouldApplyBestPlan(
    { avg_policy_ret_net: 0.0020, beneficial_wait_rate: 0.58, policy_neg_rate: 0.48, trigger_rate: 0.18 },
    { avg_policy_ret_net: 0.0021, beneficial_wait_rate: 0.63, policy_neg_rate: 0.50, trigger_rate: 0.15 },
    true,
    0.60,
    { currentObjective: { monthly_pass: false, net_pass: true, ev_pass: true, win_pass: true } },
  ), false);
  assert.strictEqual(__test.isWaitTighteningChange(
    currentCfg,
    { ...currentCfg, sameDirStreakMin: 4 }
  ), true);
  assert.strictEqual(__test.bestFebtAllowsWaitPlan(
    { tightening_allowed: false, recovery_priority: true },
    currentCfg,
    { ...currentCfg, sameDirStreakMin: 4 }
  ), false);
  assert.strictEqual(__test.bestFebtAllowsWaitPlan(
    { market: "DOGEUSDT", tightening_allowed: false, recovery_priority: false },
    currentCfg,
    { ...currentCfg, chaseRatioMin: 1.95 }
  ), false);
  assert.strictEqual(__test.bestFebtAllowsWaitPlan(
    { tightening_allowed: true, recovery_priority: false },
    currentCfg,
    { ...currentCfg, sameDirStreakMin: 2 }
  ), true);

  const summary = __test.summarizeConfig(currentCfg);
  assert.strictEqual(summary.wait_one_bar_same_dir_streak_min, 3);
  assert.strictEqual(summary.wait_one_bar_counter_dir_bars_max, 0);

  console.log('WAIT_ONE_BAR_TUNE_TEST_OK');
})();
