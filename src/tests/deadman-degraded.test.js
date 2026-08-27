const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { checkArtifacts } = require("../v3/deadmanCheck");

// 2026-08-27 — pins the failure mode that hid a 25-hour v7 outage.
//
// The collector and the lane both ran on schedule. Every network call failed.
// Both exited 0 and wrote a fresh artifact listing the failures in a field
// nothing read. The deadman checked mtime only, saw a recent file, and
// reported healthy — so a total outage looked exactly like normal operation,
// which is the single thing a deadman exists to rule out.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "deadman-"));
const write = (name, doc) => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, JSON.stringify(doc));
  return p;
};
const allFailed = (doc) => {
  const failed = Array.isArray(doc.errors) ? doc.errors.length : 0;
  const symbols = Number(doc.symbols) || 0;
  return symbols && failed >= symbols ? `every fetch failed (${failed})` : null;
};

// (A) fresh file, every symbol failed -> STALE. This is the regression.
{
  const p = write("broken.json", { symbols: 24, errors: Array(24).fill("fetch failed") });
  const r = checkArtifacts([{ name: "lane", path: p, max_age_ms: 1e9, degraded: allFailed }]);
  assert.strictEqual(r.stale.length, 1, "(A1) a fresh artifact from a fully failed run must be stale");
  assert.ok(r.stale[0].degraded_reason.includes("every fetch failed"), "(A2) the reason must name the cause");
  assert.strictEqual(r.ok, false, "(A3) overall not ok");
}

// (B) partial failure is normal operation and must NOT alarm. A deadman that
// fires on one timed-out symbol gets muted, and then the real outage is missed.
{
  const p = write("partial.json", { symbols: 24, errors: ["SOLUSDT: timeout"] });
  const r = checkArtifacts([{ name: "lane", path: p, max_age_ms: 1e9, degraded: allFailed }]);
  assert.strictEqual(r.healthy.length, 1, "(B1) one failed symbol out of 24 is healthy");
}

// (C) booking nothing is normal for v7 — most ticks have no closed period to
// act on — so idleness alone must never be treated as degraded.
{
  const p = write("idle.json", { symbols: 24, errors: [], rebalanced_this_cycle: 0 });
  const r = checkArtifacts([{ name: "lane", path: p, max_age_ms: 1e9, degraded: allFailed }]);
  assert.strictEqual(r.healthy.length, 1, "(C1) an idle but working cycle is healthy");
}

// (D) an unparseable artifact is a failure, not a pass. Returning healthy
// because JSON.parse threw would reproduce the original bug in a new place.
{
  const p = path.join(tmp, "corrupt.json");
  fs.writeFileSync(p, "{ this is not json");
  const r = checkArtifacts([{ name: "lane", path: p, max_age_ms: 1e9, degraded: allFailed }]);
  assert.strictEqual(r.stale.length, 1, "(D1) unreadable artifact is stale");
  assert.ok(r.stale[0].degraded_reason.includes("unreadable"), "(D2) reason says unreadable");
}

// (E) a descriptor with no degraded predicate keeps the old age-only behaviour.
{
  const p = write("plain.json", { anything: true });
  const r = checkArtifacts([{ name: "lane", path: p, max_age_ms: 1e9 }]);
  assert.strictEqual(r.healthy.length, 1, "(E1) age-only descriptors still work");
}

// (F) age still wins on its own: a stale file is stale even if contents look fine.
{
  const p = write("old.json", { symbols: 24, errors: [] });
  const r = checkArtifacts([{ name: "lane", path: p, max_age_ms: 1, degraded: allFailed }], Date.now() + 60_000);
  assert.strictEqual(r.stale.length, 1, "(F1) age check is unchanged");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log("DEADMAN_DEGRADED_TESTS_PASS");
