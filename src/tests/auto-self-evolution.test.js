"use strict";

const assert = require("assert");
const autoSelfEvolution = require("../scheduler/autoSelfEvolution");
const runner = require("../scheduler/selfEvolutionRunner");

function hoursAgo(hours) {
  return new Date(Date.now() - (hours * 60 * 60 * 1000)).toISOString();
}

function run() {
  assert.strictEqual(typeof autoSelfEvolution.autoSelfEvolutionEnabled, "function");
  assert.strictEqual(typeof autoSelfEvolution.__test.shouldRunSelfEvolutionLoop, "function");
  assert.strictEqual(typeof runner.__test.parseLastJsonLine, "function");

  const fresh = { generated_at: hoursAgo(1) };
  const stale = { generated_at: hoursAgo(8) };

  assert.strictEqual(runner.isFreshSelfEvolutionLatest(fresh, Date.now(), 4 * 60 * 60 * 1000), true);
  assert.strictEqual(runner.isFreshSelfEvolutionLatest(stale, Date.now(), 4 * 60 * 60 * 1000), false);
  assert.strictEqual(autoSelfEvolution.__test.shouldRunSelfEvolutionLoop(fresh, Date.now(), 4 * 60 * 60 * 1000), false);
  assert.strictEqual(autoSelfEvolution.__test.shouldRunSelfEvolutionLoop(stale, Date.now(), 4 * 60 * 60 * 1000), true);

  const parsed = runner.__test.parseLastJsonLine("hello\n{\"ok\":true,\"cycle_id\":\"cycle-1\"}\n");
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.cycle_id, "cycle-1");

  console.log("AUTO_SELF_EVOLUTION_TEST_OK");
}

if (require.main === module) {
  run();
}

module.exports = run;
