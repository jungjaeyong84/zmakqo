const assert = require("assert");
const fs = require("fs");

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function assertTransitionLeadPatch(path, expectedStrategyId) {
  const text = read(path);
  assert.ok(text.includes(`v${expectedStrategyId.replace("donbeolja_v", "")}`), `${path}: header version mismatch`);
  assert.ok(text.includes(`string STRATEGY_ID = "${expectedStrategyId}"`), `${path}: strategy id mismatch`);
  assert.ok(text.includes("[PATCH-72] TRANSITION_EARLY_LEAD_TO_CORE"), `${path}: missing patch comment`);
  assert.ok(text.includes("bool transition_lead_long ="), `${path}: missing transition_lead_long`);
  assert.ok(text.includes("bool transition_lead_short ="), `${path}: missing transition_lead_short`);
  assert.ok(text.includes("zz_post_prob_long >= 0.70"), `${path}: missing long posterior gate`);
  assert.ok(text.includes("sp_transition_risk <= 0.58"), `${path}: missing transition risk gate`);
  assert.ok(text.includes("core_long_cond := true"), `${path}: missing long core promotion`);
  assert.ok(text.includes("core_short_cond := true"), `${path}: missing short core promotion`);
}

function run() {
  assertTransitionLeadPatch(
    "/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_latest_generated.pine.txt",
    "donbeolja_v6.0.3.3"
  );
  assertTransitionLeadPatch(
    "/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_v6.0.3.3.pine.txt",
    "donbeolja_v6.0.3.3"
  );
  console.log("PINE_TRANSITION_LEAD_SOURCE_TEST_OK");
}

run();
