"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { main, renderMarkdown } = require("../../scripts/generate-v2-openclaw-policy-candidate-from-root-cause");

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "v2-policy-candidate-root-cause-"));
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

const tmp = mkTmp();
const input = path.join(tmp, "analysis.json");
const output = path.join(tmp, "candidate.json");
const markdown = path.join(tmp, "candidate.md");
writeJson(input, {
  ok: true,
  generated_at: "2026-05-04T00:00:00.000Z",
  sample_n: 120,
  total: { n: 120, net_pnl_usdt: -12, profit_factor: 0.5 },
  root_cause_findings: [
    {
      id: "PULLBACK_RECLAIM_DECAY",
      group: "by_setup_type",
      evidence: { key: "PULLBACK_RECLAIM", n: 40, net_pnl_usdt: -10, profit_factor: 0.2 },
      if_removed: { kept_n: 80, kept_net_pnl_usdt: -2, kept_profit_factor: 0.9 },
    },
  ],
});

const result = main({
  V2_OPENCLAW_POLICY_CANDIDATE_ROOT_CAUSE_FILE: input,
  V2_OPENCLAW_POLICY_CANDIDATE_OUTPUT_FILE: output,
  V2_OPENCLAW_POLICY_CANDIDATE_MARKDOWN_FILE: markdown,
  DONBEOLJA_V2_OPENCLAW_POLICY_CANDIDATE_MIN_SAMPLE_N: "100",
  DONBEOLJA_V2_OPENCLAW_POLICY_AUTO_APPLY_ENABLED: "0",
});
assert.strictEqual(result.ok, true);
assert.ok(fs.existsSync(output));
assert.ok(fs.existsSync(markdown));
const saved = JSON.parse(fs.readFileSync(output, "utf8"));
assert.strictEqual(saved.policy_candidate_id, result.policy_candidate_id);
assert.ok(fs.readFileSync(markdown, "utf8").includes("SHADOW_SUPPRESS_PULLBACK_RECLAIM"));
assert.ok(renderMarkdown(result).includes("live_apply_allowed: false"));

console.log("GENERATE_V2_OPENCLAW_POLICY_CANDIDATE_FROM_ROOT_CAUSE_TEST_OK");
