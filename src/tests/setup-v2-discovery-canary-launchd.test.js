"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const setup = require("../../scripts/setup-v2-discovery-canary-launchd");

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
})();

(function dryRunWritesArtifactWithoutCopying() {
  withTempDir("dbj-v2-discovery-launchd-dry-", (dir) => {
    const paths = makePaths(dir);
    fs.writeFileSync(paths.sourcePlist, "<plist/>", "utf8");
    const launchctl = makeLaunchctlStub({ loadedBefore: false, loadedAfter: false });

    const result = setup.setupLaunchd({
      argv: ["--dry-run", "--enable"],
      deps: { runLaunchctlFn: launchctl.runLaunchctlFn, getuid: () => 501 },
      paths,
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.reason, "V2_DISCOVERY_CANARY_LAUNCHD_DRY_RUN");
    assert.strictEqual(result.copied, false);
    assert.strictEqual(fs.existsSync(paths.targetPlist), false);
  });
})();

(function enableBootstrapsAndKickstarts() {
  withTempDir("dbj-v2-discovery-launchd-enable-", (dir) => {
    const paths = makePaths(dir);
    fs.writeFileSync(paths.sourcePlist, "<plist/>", "utf8");
    const launchctl = makeLaunchctlStub({ loadedBefore: false, loadedAfter: true });

    const result = setup.setupLaunchd({
      argv: ["--enable", "--kickstart"],
      deps: { runLaunchctlFn: launchctl.runLaunchctlFn, getuid: () => 501 },
      paths,
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.reason, "V2_DISCOVERY_CANARY_LAUNCHD_ENABLED");
    assert.deepStrictEqual(launchctl.calls, [
      ["print", "gui/501/com.jeongjaeyong.donbeolja.v2discoverycanaryautodeploy"],
      ["bootstrap", "gui/501", paths.targetPlist],
      ["enable", "gui/501/com.jeongjaeyong.donbeolja.v2discoverycanaryautodeploy"],
      ["kickstart", "-k", "gui/501/com.jeongjaeyong.donbeolja.v2discoverycanaryautodeploy"],
      ["print", "gui/501/com.jeongjaeyong.donbeolja.v2discoverycanaryautodeploy"],
    ]);
  });
})();

console.log("SETUP_V2_DISCOVERY_CANARY_LAUNCHD_TEST_OK");
