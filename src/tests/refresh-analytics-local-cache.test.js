"use strict";

const assert = require("assert");

const refreshAnalyticsLocalCache = require("../../scripts/refresh-analytics-local-cache.js");

(() => {
  assert.deepStrictEqual(
    refreshAnalyticsLocalCache.__test.DEPENDENT_REPORT_SCRIPTS,
    [
      "report-server-signal-authority.js",
      "report-server-signal-quality.js",
      "report-server-signal-runtime.js",
      "report-server-signal-cutover-readiness.js",
      "build-feature-label-dataset.js",
      "report-shadow-evaluation-summary.js",
      "report-shadow-inference-canary.js",
      "report-best-self-evolution-ev-gate-composite-policy.js",
      "report-best-self-evolution-openclaw-autonomy-contract.js",
      "report-best-self-evolution-loop-monitor.js",
    ]
  );
  console.log("REFRESH_ANALYTICS_LOCAL_CACHE_TEST_OK");
})();
