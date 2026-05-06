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

(function runtimeEnvSnapshotWritesOutputFile() {
  withTempDir("dbj-local-cost-saver-env-", (dir) => {
    const outputFile = path.join(dir, "local_cost_saver_runtime.env");
    const result = setup.__test.writeRuntimeEnvSnapshot({
      fsApi: fs,
      outputFile,
      now: () => "2026-05-06T05:10:00.000Z",
      execFileSyncFn() {
        return JSON.stringify({
          spec: {
            template: {
              spec: {
                containers: [{
                  env: [
                    { name: "DONBEOLJA_V2_ENABLED", value: "1" },
                    { name: "DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED", value: "1" },
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
    const contents = fs.readFileSync(outputFile, "utf8");
    assert.ok(contents.includes("export DONBEOLJA_V2_ENABLED='1'"));
    assert.ok(contents.includes("export DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED='1'"));
    assert.ok(!contents.includes("SESSION_SECRET"));
  });
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

console.log("SETUP_V2_LOCAL_COST_SAVER_TEST_OK");
