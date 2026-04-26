"use strict";

const assert = require("assert");

const refreshAnalyticsLocalCache = require("../../scripts/refresh-analytics-local-cache.js");
const analyticsLocalCacheRunner = require("../scheduler/analyticsLocalCacheRunner");

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
  assert.deepStrictEqual(
    analyticsLocalCacheRunner.__test.BOUNDED_REFRESH_ENV,
    {
      ANALYTICS_CACHE_DEFAULT_LIMIT: "3000",
      ANALYTICS_CACHE_FILLS_LIMIT: "6000",
      ANALYTICS_CACHE_PAGE_SIZE: "500",
      ANALYTICS_CACHE_SKIP_DEPENDENT_REPORTS: "1",
    }
  );
  console.log("REFRESH_ANALYTICS_LOCAL_CACHE_TEST_OK");
})();
