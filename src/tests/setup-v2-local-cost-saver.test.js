"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const setup = require("../../scripts/setup-v2-local-cost-saver");

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

function makeLaunchctlStub({ loadedBefore = false, loadedAfter = true } = {}) {
  const calls = [];
  let printCount = 0;
  return {
    calls,
    runLaunchctl(args) {
      calls.push(args);
      if (args[0] === "print") {
        printCount += 1;
        const ok = printCount === 1 ? loadedBefore : loadedAfter;
        return { ok, stdout: "", stderr: ok ? "" : "not loaded" };
      }
      return { ok: true, stdout: "", stderr: "" };
    },
  };
}

(function parseArgsDefaultsToDryRun() {
  assert.deepStrictEqual(setup.__test.parseArgs([]), {
    dryRun: true,
    install: false,
    enable: false,
    kickstart: false,
  });
  assert.deepStrictEqual(setup.__test.parseArgs(["--enable", "--kickstart"]), {
    dryRun: false,
    install: true,
    enable: true,
    kickstart: true,
  });
})();

(function renderPlistSupportsIntervalsAndCalendars() {
  const intervalPlist = setup.__test.renderPlist({
    label: "test.interval",
    wrapper: "/tmp/run.sh",
    log_basename: "interval_job",
    start_interval_seconds: 300,
    runAtLoad: true,
  });
  assert.ok(intervalPlist.includes("<key>StartInterval</key>"));
  assert.ok(intervalPlist.includes("<integer>300</integer>"));

  const calendarPlist = setup.__test.renderPlist({
    label: "test.calendar",
    wrapper: "/tmp/run.sh",
    log_basename: "calendar_job",
    start_calendar_interval: [{ minute: 5 }, { hour: 7, minute: 10 }],
    runAtLoad: false,
  });
  assert.ok(calendarPlist.includes("<key>StartCalendarInterval</key>"));
  assert.ok(calendarPlist.includes("<key>Hour</key>"));
  assert.ok(calendarPlist.includes("<integer>7</integer>"));
  assert.ok(calendarPlist.includes("<false/>"));
})();

(function dryRunOnlyReturnsPlan() {
  const result = setup.main({ argv: ["--dry-run"] });
  assert.strictEqual(result.ok, true);
  assert.ok(result.job_n >= 10);
  assert.strictEqual(result.jobs.every((row) => row.target_plist && row.wrapper), true);
  assert.strictEqual(result.keepalive_agent_n, 2);
  assert.strictEqual(result.keepalive_agents.length, 2);
  assert.strictEqual(result.keepalive_agents.some((row) => row.label === "com.jeongjaeyong.donbeolja.server"), true);
  assert.strictEqual(result.keepalive_agents.some((row) => row.label === "com.jeongjaeyong.donbeolja.exitworker"), true);
  assert.ok(result.cloud_scheduler_pause_targets.includes("v2-fill-sync"));
})();

(function runtimeEnvSnapshotRendersCloudRunLiteralValuesOnly() {
  const rendered = setup.__test.renderRuntimeEnvFile([
    { name: "DONBEOLJA_V2_ENABLED", value: "1" },
    { name: "DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED", value: "1" },
    { name: "DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS", value: "BTCUSDT|AAVEUSDT" },
  ], {
    generatedAt: "2026-05-06T05:10:00.000Z",
    service: "donbeolja",
    region: "asia-northeast3",
    project: "donbeolja-dev",
  });
  assert.ok(rendered.includes("source=cloud-run service=donbeolja region=asia-northeast3 project=donbeolja-dev"));
  assert.ok(rendered.includes("export DONBEOLJA_V2_ENABLED='1'"));
  assert.ok(rendered.includes("export DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED='1'"));
  assert.ok(rendered.includes("export DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS='BTCUSDT|AAVEUSDT'"));
})();

(function localCostSaverRuntimeOverridesPreferLocalPrimary() {
  const rows = setup.__test.applyLocalCostSaverRuntimeOverrides([
    { name: "BASE_URL", value: "https://donbeolja-4ljfegivrq-du.a.run.app", source: "literal" },
    { name: "EXIT_WORKER_URL", value: "https://donbeolja-exit-worker-4ljfegivrq-du.a.run.app", source: "literal" },
    { name: "EGRESS_PROXY_URL", value: "https://donbeolja-egress-4ljfegivrq-du.a.run.app", source: "literal" },
    { name: "EGRESS_PROXY_BINANCE_PRIVATE_URL", value: "https://donbeolja-egress-private-4ljfegivrq-du.a.run.app", source: "literal" },
    { name: "EGRESS_PROXY_MODE", value: "client", source: "literal" },
    { name: "DONBEOLJA_V2_ENABLED", value: "1", source: "literal" },
  ]);
  const byName = new Map(rows.map((row) => [row.name, row]));
  assert.strictEqual(byName.get("BASE_URL").value, "http://127.0.0.1:3000");
  assert.strictEqual(byName.get("EXIT_WORKER_URL").value, "http://127.0.0.1:8080");
  assert.strictEqual(byName.get("EXIT_WORKER_SELF_URL").value, "http://127.0.0.1:8080");
  assert.strictEqual(byName.get("EXIT_WORKER_LOCAL_PORT").value, "8080");
  assert.strictEqual(byName.get("AUTOMATION_WATCHDOG_SCHEDULER_BASE_URL").value, "http://127.0.0.1:3000");
  assert.strictEqual(byName.get("EGRESS_PROXY_URL").value, "");
  assert.strictEqual(byName.get("EGRESS_PROXY_BINANCE_PRIVATE_URL").value, "");
  assert.strictEqual(byName.get("EGRESS_PROXY_MODE").value, "");
  assert.strictEqual(byName.get("DONBEOLJA_V2_ENABLED").value, "1");
})();

(function runtimeEnvSnapshotWritesOutputFile() {
  withTempDir("dbj-local-cost-saver-env-", (dir) => {
    const outputFile = path.join(dir, "local_cost_saver_runtime.env");
    const result = setup.__test.writeRuntimeEnvSnapshot({
      fsApi: fs,
      outputFile,
      env: { SCHEDULER_TOKEN: "local-scheduler-token" },
      now: () => "2026-05-06T05:10:00.000Z",
      execFileSyncFn(cmd, args) {
        if (cmd === "gcloud" && Array.isArray(args) && args[0] === "secrets") {
          return "secret-from-secret-manager\n";
        }
        return JSON.stringify({
          spec: {
            template: {
              spec: {
                containers: [{
                  env: [
                    { name: "DONBEOLJA_V2_ENABLED", value: "1" },
                    { name: "DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED", value: "1" },
                    { name: "SCHEDULER_TOKEN", valueFrom: { secretKeyRef: { name: "DONBEOLJA_SCHEDULER_TOKEN", key: "latest" } } },
                    { name: "SESSION_SECRET", valueFrom: { secretKeyRef: { name: "SECRET", key: "latest" } } },
                  ],
                }],
              },
            },
          },
        });
      },
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.literal_env_n, 2);
    assert.strictEqual(result.secret_env_n, 2);
    assert.strictEqual(result.synced_secret_env_n, 2);
    assert.strictEqual(result.local_override_env_n, 8);
    const contents = fs.readFileSync(outputFile, "utf8");
    assert.ok(contents.includes("export DONBEOLJA_V2_ENABLED='1'"));
    assert.ok(contents.includes("export DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED='1'"));
    assert.ok(contents.includes("export SCHEDULER_TOKEN='local-scheduler-token'"));
    assert.ok(contents.includes("export SESSION_SECRET='secret-from-secret-manager'"));
    assert.ok(contents.includes("mode=local-primary-cloud-cold-standby"));
    assert.ok(contents.includes("export BASE_URL='http://127.0.0.1:3000'"));
    assert.ok(contents.includes("export EXIT_WORKER_URL='http://127.0.0.1:8080'"));
    assert.ok(contents.includes("export EGRESS_PROXY_MODE=''"));
    assert.ok(contents.includes("export EGRESS_PROXY_URL=''"));
    assert.ok(contents.includes("export EGRESS_PROXY_BINANCE_PRIVATE_URL=''"));
    assert.ok(!contents.includes("https://donbeolja-exit-worker-4ljfegivrq-du.a.run.app"));
  });
})();

(function resolveRuntimeEnvRowsFetchesSecretManagerWhenLocalEnvMissing() {
  const calls = [];
  const result = setup.__test.resolveRuntimeEnvRows([
    { name: "A", value: "1", source: "literal" },
    { name: "B", source: "secret", secret_name: "B_SECRET", secret_version: "latest" },
    { name: "C", source: "unset" },
  ], {
    env: {},
    project: "donbeolja-dev",
    execFileSyncFn(cmd, args) {
      calls.push([cmd, args]);
      return "b-secret-value\n";
    },
  });
  assert.strictEqual(result.literal_env_n, 1);
  assert.strictEqual(result.secret_env_n, 1);
  assert.strictEqual(result.synced_secret_env_n, 1);
  assert.strictEqual(result.skipped_unset_env_n, 1);
  assert.strictEqual(result.rows[1].value, "b-secret-value");
  assert.deepStrictEqual(calls[0], [
    "gcloud",
    ["secrets", "versions", "access", "latest", "--secret", "B_SECRET", "--project", "donbeolja-dev"],
  ]);
})();

(function installWritesPlistAndLaunchctlCalls() {
  withTempDir("dbj-local-cost-saver-", (dir) => {
    const plistTarget = path.join(dir, "LaunchAgents", "test.plist");
    const launchctl = makeLaunchctlStub({ loadedBefore: false, loadedAfter: true });
    const memoryFs = {
      ...fs,
      writeFileSync(filePath, data, encoding) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        return fs.writeFileSync(filePath, data, encoding);
      },
    };
    const result = setup.__test.installJob({
      label: "com.test.job",
      scheduler_name: "test-job",
      wrapper: "/tmp/run.sh",
      log_basename: "test_job",
      start_interval_seconds: 300,
      runAtLoad: true,
    }, {
      fsApi: memoryFs,
      uid: 501,
      runner: launchctl.runLaunchctl,
      enable: true,
      kickstart: true,
      targetPlistOverride: plistTarget,
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.target_plist, plistTarget);
    assert.deepStrictEqual(launchctl.calls, [
      ["print", "gui/501/com.test.job"],
      ["bootstrap", "gui/501", plistTarget],
      ["enable", "gui/501/com.test.job"],
      ["kickstart", "-k", "gui/501/com.test.job"],
      ["print", "gui/501/com.test.job"],
    ]);
    const contents = fs.readFileSync(plistTarget, "utf8");
    assert.ok(contents.includes("/tmp/run.sh"));
  });
})();

(function installKeepAliveAgentWritesPlistAndLaunchctlCalls() {
  withTempDir("dbj-local-cost-saver-agent-", (dir) => {
    const plistTarget = path.join(dir, "LaunchAgents", "agent.plist");
    const launchctl = makeLaunchctlStub({ loadedBefore: false, loadedAfter: true });
    const memoryFs = {
      ...fs,
      writeFileSync(filePath, data, encoding) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        return fs.writeFileSync(filePath, data, encoding);
      },
    };
    const result = setup.__test.installKeepAliveAgent({
      label: "com.test.exitworker",
      wrapper: "/tmp/run_exit_worker_server.sh",
      log_basename: "exit_worker_server",
      runAtLoad: true,
      keepAlive: true,
      role: "EXIT_WORKER",
    }, {
      fsApi: memoryFs,
      uid: 501,
      runner: launchctl.runLaunchctl,
      enable: true,
      kickstart: true,
      targetPlistOverride: plistTarget,
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.target_plist, plistTarget);
    assert.strictEqual(result.role, "EXIT_WORKER");
    assert.deepStrictEqual(launchctl.calls, [
      ["print", "gui/501/com.test.exitworker"],
      ["bootstrap", "gui/501", plistTarget],
      ["enable", "gui/501/com.test.exitworker"],
      ["kickstart", "-k", "gui/501/com.test.exitworker"],
      ["print", "gui/501/com.test.exitworker"],
    ]);
    const contents = fs.readFileSync(plistTarget, "utf8");
    assert.ok(contents.includes("<key>KeepAlive</key>"));
    assert.ok(contents.includes("/tmp/run_exit_worker_server.sh"));
  });
})();

(function verifyLocalPrimaryHealthProbesServerAndExitWorker() {
  const calls = [];
  const result = setup.__test.verifyLocalPrimaryHealth({
    checks: [
      { role: "SERVER", url: "http://127.0.0.1:3000/health" },
      { role: "EXIT_WORKER", url: "http://127.0.0.1:8080/health" },
    ],
    execFileSyncFn(cmd, args) {
      calls.push([cmd, args]);
      if (String(args[args.length - 1]).includes(":3000/health")) return '{"ok":true,"service":"donbeolja"}\n';
      if (String(args[args.length - 1]).includes(":8080/health")) return '{"ok":true,"service":"donbeolja-exit-worker"}\n';
      throw new Error("unexpected url");
    },
  });
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result.every((row) => row.ok === true), true);
  assert.strictEqual(calls.length, 2);
})();

console.log("SETUP_V2_LOCAL_COST_SAVER_TEST_OK");
