"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const setup = require("../../scripts/setup-v2-repair-firestore-canary-launchd");

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

function makePaths(dir) {
  return {
    sourcePlist: path.join(dir, "source.plist"),
    targetPlist: path.join(dir, "LaunchAgents", "target.plist"),
    outputFile: path.join(dir, "artifact.json"),
  };
}

function makeLaunchctlStub({ loadedBefore = false, loadedAfter = true } = {}) {
  const calls = [];
  let printCount = 0;
  return {
    calls,
    runLaunchctlFn(args) {
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
  assert.deepStrictEqual(setup.__test.parseArgs(["--install"]), {
    dryRun: false,
    install: true,
    enable: false,
    kickstart: false,
  });
  assert.deepStrictEqual(setup.__test.parseArgs(["--enable", "--kickstart"]), {
    dryRun: false,
    install: true,
    enable: true,
    kickstart: true,
  });
  assert.strictEqual(setup.__test.parseArgs(["--dry-run", "--enable"]).dryRun, true);
})();

(function dryRunWritesArtifactWithoutCopyingOrMutatingLaunchd() {
  withTempDir("dbj-v2-fs-canary-launchd-dry-", (dir) => {
    const paths = makePaths(dir);
    fs.writeFileSync(paths.sourcePlist, "<plist/>", "utf8");
    const launchctl = makeLaunchctlStub({ loadedBefore: false, loadedAfter: false });

    const result = setup.setupLaunchd({
      argv: ["--dry-run", "--enable"],
      now: () => "2026-04-21T03:00:00.000Z",
      deps: { runLaunchctlFn: launchctl.runLaunchctlFn, getuid: () => 501 },
      paths,
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.reason, "V2_REPAIR_FIRESTORE_CANARY_LAUNCHD_DRY_RUN");
    assert.strictEqual(result.dry_run, true);
    assert.strictEqual(result.copied, false);
    assert.strictEqual(fs.existsSync(paths.targetPlist), false);
    assert.deepStrictEqual(launchctl.calls, [["print", "gui/501/com.jeongjaeyong.donbeolja.v2repairfirestorecanary"]]);
    assert.strictEqual(JSON.parse(fs.readFileSync(paths.outputFile, "utf8")).reason, result.reason);
  });
})();

(function installCopiesPlistButDoesNotEnableOrKickstart() {
  withTempDir("dbj-v2-fs-canary-launchd-install-", (dir) => {
    const paths = makePaths(dir);
    fs.writeFileSync(paths.sourcePlist, "<plist><dict/></plist>", "utf8");
    const launchctl = makeLaunchctlStub({ loadedBefore: false, loadedAfter: false });

    const result = setup.setupLaunchd({
      argv: ["--install"],
      deps: { runLaunchctlFn: launchctl.runLaunchctlFn, getuid: () => 501 },
      paths,
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.reason, "V2_REPAIR_FIRESTORE_CANARY_LAUNCHD_INSTALLED");
    assert.strictEqual(result.copied, true);
    assert.strictEqual(fs.readFileSync(paths.targetPlist, "utf8"), "<plist><dict/></plist>");
    assert.strictEqual(result.enable, null);
    assert.strictEqual(result.kickstart, null);
    assert.deepStrictEqual(launchctl.calls, [
      ["print", "gui/501/com.jeongjaeyong.donbeolja.v2repairfirestorecanary"],
      ["print", "gui/501/com.jeongjaeyong.donbeolja.v2repairfirestorecanary"],
    ]);
  });
})();

(function enableBootstrapsEnablesAndKickstartsWhenRequested() {
  withTempDir("dbj-v2-fs-canary-launchd-enable-", (dir) => {
    const paths = makePaths(dir);
    fs.writeFileSync(paths.sourcePlist, "<plist/>", "utf8");
    const launchctl = makeLaunchctlStub({ loadedBefore: false, loadedAfter: true });

    const result = setup.setupLaunchd({
      argv: ["--enable", "--kickstart"],
      deps: { runLaunchctlFn: launchctl.runLaunchctlFn, getuid: () => 501 },
      paths,
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.reason, "V2_REPAIR_FIRESTORE_CANARY_LAUNCHD_ENABLED");
    assert.strictEqual(result.loaded_after, true);
    assert.deepStrictEqual(launchctl.calls, [
      ["print", "gui/501/com.jeongjaeyong.donbeolja.v2repairfirestorecanary"],
      ["bootstrap", "gui/501", paths.targetPlist],
      ["enable", "gui/501/com.jeongjaeyong.donbeolja.v2repairfirestorecanary"],
      ["kickstart", "-k", "gui/501/com.jeongjaeyong.donbeolja.v2repairfirestorecanary"],
      ["print", "gui/501/com.jeongjaeyong.donbeolja.v2repairfirestorecanary"],
    ]);
  });
})();

(function missingSourceFailsClosedAndWritesArtifact() {
  withTempDir("dbj-v2-fs-canary-launchd-missing-", (dir) => {
    const paths = makePaths(dir);
    const launchctl = makeLaunchctlStub({ loadedBefore: false, loadedAfter: false });

    const result = setup.setupLaunchd({
      argv: ["--enable"],
      deps: { runLaunchctlFn: launchctl.runLaunchctlFn, getuid: () => 501 },
      paths,
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "SOURCE_PLIST_MISSING");
    assert.strictEqual(JSON.parse(fs.readFileSync(paths.outputFile, "utf8")).ok, false);
  });
})();

console.log("SETUP_V2_REPAIR_FIRESTORE_CANARY_LAUNCHD_TEST_OK");
