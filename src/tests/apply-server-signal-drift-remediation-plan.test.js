"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/apply-server-signal-drift-remediation-plan");

(() => {
  const out = __test.derivePatchState({
    evCurrent: { SOLUSDT: 0.515 },
    evPatch: { SOLUSDT: 0.501, ETHUSDT: 0.501 },
    cooldownCurrent: { XRPUSDT: 3 },
    cooldownPatch: { XRPUSDT: 2 },
    otherPolicyWatchCurrent: [],
    otherPolicyWatchPatch: ["ETHUSDT"],
    otherPolicyWatchByReasonCurrent: {},
    otherPolicyWatchByReasonPatch: { LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED: ["ETHUSDT"] },
    releaseExceptions: true,
  });

  assert.deepStrictEqual(out.evNext, {});
  assert.deepStrictEqual(out.evReportOnlyNext, { SOLUSDT: 0.501, ETHUSDT: 0.501 });
  assert.strictEqual(out.evReportOnlyCohortNext, 0.495);
  assert.deepStrictEqual(out.cooldownNext, {});
  assert.deepStrictEqual(out.otherPolicyWatchNext, []);
  assert.strictEqual(out.exception_release_applied, true);
  assert.strictEqual(out.ev_policy_patch_requested_n, 2);
  assert.strictEqual(out.ev_policy_patch_applied_n, 0);
  assert.strictEqual(out.ev_policy_patch_applied, false);
  assert.strictEqual(out.ev_policy_patch_report_only_applied_n, 2);
  assert.strictEqual(out.ev_policy_patch_report_only_applied, true);
  assert.strictEqual(out.ev_policy_patch_report_only_cohort_applied, true);
  assert.strictEqual(out.ev_policy_patch_report_only_cohort_threshold, 0.495);
})();

(() => {
  const out = __test.derivePatchState({
    evCurrent: { SOLUSDT: 0.515 },
    evPatch: { SOLUSDT: 0.501, ETHUSDT: 0.501 },
    cooldownCurrent: { XRPUSDT: 3 },
    cooldownPatch: { XRPUSDT: 2 },
    otherPolicyWatchCurrent: [],
    otherPolicyWatchPatch: ["ETHUSDT"],
    otherPolicyWatchByReasonCurrent: {},
    otherPolicyWatchByReasonPatch: { LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED: ["ETHUSDT"] },
    releaseExceptions: false,
  });

  assert.deepStrictEqual(out.evNext, { SOLUSDT: 0.501, ETHUSDT: 0.501 });
  assert.deepStrictEqual(out.evReportOnlyNext, {});
  assert.strictEqual(out.evReportOnlyCohortNext, null);
  assert.deepStrictEqual(out.cooldownNext, { XRPUSDT: 2 });
  assert.deepStrictEqual(out.otherPolicyWatchNext, ["ETHUSDT"]);
  assert.strictEqual(out.exception_release_applied, false);
  assert.strictEqual(out.ev_policy_patch_requested_n, 2);
  assert.strictEqual(out.ev_policy_patch_applied_n, 2);
  assert.strictEqual(out.ev_policy_patch_applied, true);
  assert.strictEqual(out.ev_policy_patch_report_only_applied_n, 0);
  assert.strictEqual(out.ev_policy_patch_report_only_applied, false);
  assert.strictEqual(out.ev_policy_patch_report_only_cohort_applied, false);
  assert.strictEqual(out.ev_policy_patch_report_only_cohort_threshold, null);
})();

(() => {
  const a = __test.computeAppliedSignature({
    exception_release_applied: true,
    evNext: {},
    evReportOnlyNext: { ETHUSDT: 0.501, SOLUSDT: 0.501 },
    cooldownNext: {},
    otherPolicyWatchNext: ["ETHUSDT"],
    otherPolicyWatchByReasonNext: { LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED: ["ETHUSDT"] },
  });
  const b = __test.computeAppliedSignature({
    exception_release_applied: true,
    evNext: {},
    evReportOnlyNext: { SOLUSDT: 0.501, ETHUSDT: 0.501 },
    cooldownNext: {},
    otherPolicyWatchNext: ["ETHUSDT"],
    otherPolicyWatchByReasonNext: { LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED: ["ETHUSDT"] },
  });
  assert.strictEqual(a, b);
})();

console.log("APPLY_SERVER_SIGNAL_DRIFT_REMEDIATION_PLAN_TEST_OK");
