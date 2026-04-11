"use strict";

const assert = require("assert");

async function run() {
  const servicePath = require.resolve("../services/systemRuntimeGuardView");
  const sloPath = require.resolve("../services/systemSloRuntime");
  const anomalyPath = require.resolve("../services/systemAnomalyRuntime");
  const remediationStatePath = require.resolve("../storage/systemAnomalyRemediationStates");
  const operationalStatePath = require.resolve("../storage/operationalRuntimeStates");

  const prev = {
    service: require.cache[servicePath],
    slo: require.cache[sloPath],
    anomaly: require.cache[anomalyPath],
    remediation: require.cache[remediationStatePath],
    operational: require.cache[operationalStatePath],
  };

  require.cache[sloPath] = {
    id: sloPath,
    filename: sloPath,
    loaded: true,
    exports: {
      loadSystemSloRuntime: async () => ({
        status: "WARN",
        reason: "OPS_GUARD_BLOCK",
        block_new_entries: true,
        issues: ["OPS_GUARD_BLOCK"],
        generated_at_ms: Date.parse("2026-04-11T03:00:00.000Z"),
      }),
    },
  };
  require.cache[anomalyPath] = {
    id: anomalyPath,
    filename: anomalyPath,
    loaded: true,
    exports: {
      loadSystemAnomalyRuntime: async () => ({
        status: "BLOCK",
        reason: "ANOMALY_QTY_PCT_NON_POSITIVE",
        circuit_breaker_open: true,
        issues: ["ANOMALY_QTY_PCT_NON_POSITIVE"],
        generated_at_ms: Date.parse("2026-04-11T03:05:00.000Z"),
      }),
    },
  };
  require.cache[remediationStatePath] = {
    id: remediationStatePath,
    filename: remediationStatePath,
    loaded: true,
    exports: {
      getSystemAnomalyRemediationState: async () => ({
        generated_at: "2026-04-11T03:06:00.000Z",
        remediation: {
          ok: true,
          remediated_positions: 2,
          rows: [{ symbol: "DOGEUSDT" }, { symbol: "BNBUSDT" }],
        },
      }),
    },
  };
  require.cache[operationalStatePath] = {
    id: operationalStatePath,
    filename: operationalStatePath,
    loaded: true,
    exports: {
      getOperationalRuntimeState: async () => ({
        state: {
          position_writer_authority_24h: {
            occurrence_count: 2,
            remediation_candidates: [
              { symbol: "XRPUSDT", count: 2, action: "trace 수집", severity: "LOW" },
            ],
          },
        },
      }),
    },
  };
  delete require.cache[servicePath];

  const { loadSystemRuntimeGuardView, __test } = require("../services/systemRuntimeGuardView");
  const view = await loadSystemRuntimeGuardView({ exchange: "BINANCEFUT", force: true });
  assert.strictEqual(view.exchange, "BINANCEFUT");
  assert.strictEqual(view.block_new_entries, true);
  assert.strictEqual(view.circuit_breaker_open, true);
  assert.strictEqual(view.tone, "danger");
  assert.strictEqual(view.slo_reason, "OPS_GUARD_BLOCK");
  assert.strictEqual(view.anomaly_reason, "ANOMALY_QTY_PCT_NON_POSITIVE");
  assert.strictEqual(view.remediation.remediated_positions, 2);
  assert.strictEqual(view.remediation.rows.length, 2);
  assert.strictEqual(view.writer_authority.occurrence_count, 2);
  assert.strictEqual(view.writer_authority.remediation_candidates[0].symbol, "XRPUSDT");
  assert.ok(view.generated_at_kst);

  const normalized = __test.normalizeRemediation({ remediated_positions: "3", rows: null, dry_run: 1 }, "2026-04-11T03:10:00.000Z");
  assert.strictEqual(normalized.remediated_positions, 3);
  assert.strictEqual(normalized.rows.length, 0);
  assert.strictEqual(normalized.dry_run, false);

  delete require.cache[servicePath];
  if (prev.service) require.cache[servicePath] = prev.service; else delete require.cache[servicePath];
  if (prev.slo) require.cache[sloPath] = prev.slo; else delete require.cache[sloPath];
  if (prev.anomaly) require.cache[anomalyPath] = prev.anomaly; else delete require.cache[anomalyPath];
  if (prev.remediation) require.cache[remediationStatePath] = prev.remediation; else delete require.cache[remediationStatePath];
  if (prev.operational) require.cache[operationalStatePath] = prev.operational; else delete require.cache[operationalStatePath];
}

run()
  .then(() => {
    console.log("SYSTEM_RUNTIME_GUARD_VIEW_TEST_OK");
  })
  .catch((err) => {
    console.error("SYSTEM_RUNTIME_GUARD_VIEW_TEST_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
