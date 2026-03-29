const assert = require("assert");
const {
  buildDeterministicReplayResult,
  stablePackIdentityKey,
} = require("../utils/improvementPackDeterminism");

function baseIdentity(overrides = {}) {
  return {
    exchanges: ["BINANCEFUT"],
    markets: ["BTCUSDT", "ETHUSDT"],
    base_tf: "15m",
    from_utc: "2026-03-09T00:00:00.000Z",
    to_utc: "2026-03-16T00:00:00.000Z",
    ...overrides,
  };
}

(() => {
  const first = buildDeterministicReplayResult({
    currentEventIds: ["a", "b", "c"],
    currentHash: "hash_abc",
    packIdentity: baseIdentity(),
    previousCache: null,
    savedAtUtc: "2026-03-16T00:00:00.000Z",
  });
  assert.strictEqual(first.deterministic.match_pct, 1);
  assert.strictEqual(first.deterministic.comparison_scope, "baseline_only");
  assert.strictEqual(first.deterministic.compared_with_previous_same_identity, false);
  assert.deepStrictEqual(first.deterministic.diff_files, []);
})();

(() => {
  const identity = baseIdentity();
  const packKey = stablePackIdentityKey(identity);
  const second = buildDeterministicReplayResult({
    currentEventIds: ["a", "b", "c"],
    currentHash: "hash_abc",
    packIdentity: identity,
    previousCache: {
      version: 2,
      packs: {
        [packKey]: {
          pack_identity: identity,
          hash: "hash_abc",
          event_ids: ["a", "b", "c"],
          saved_at_utc: "2026-03-15T00:00:00.000Z",
        },
      },
    },
    savedAtUtc: "2026-03-16T00:00:00.000Z",
  });
  assert.strictEqual(second.deterministic.match_pct, 1);
  assert.strictEqual(second.deterministic.comparison_scope, "same_pack_identity");
  assert.strictEqual(second.deterministic.compared_with_previous_same_identity, true);
  assert.deepStrictEqual(second.deterministic.diff_files, []);
})();

(() => {
  const oldIdentity = baseIdentity();
  const newIdentity = baseIdentity({ from_utc: "2026-03-02T00:00:00.000Z", to_utc: "2026-03-09T00:00:00.000Z" });
  const oldKey = stablePackIdentityKey(oldIdentity);
  const third = buildDeterministicReplayResult({
    currentEventIds: ["x", "y"],
    currentHash: "hash_xy",
    packIdentity: newIdentity,
    previousCache: {
      version: 2,
      packs: {
        [oldKey]: {
          pack_identity: oldIdentity,
          hash: "hash_abc",
          event_ids: ["a", "b", "c"],
          saved_at_utc: "2026-03-15T00:00:00.000Z",
        },
      },
    },
    savedAtUtc: "2026-03-16T00:00:00.000Z",
  });
  assert.strictEqual(third.deterministic.match_pct, 1);
  assert.strictEqual(third.deterministic.comparison_scope, "baseline_only");
  assert.strictEqual(third.deterministic.compared_with_previous_same_identity, false);
  assert.deepStrictEqual(third.deterministic.diff_files, []);
})();

(() => {
  const identity = baseIdentity();
  const packKey = stablePackIdentityKey(identity);
  const fourth = buildDeterministicReplayResult({
    currentEventIds: ["a", "c", "d"],
    currentHash: "hash_acd",
    packIdentity: identity,
    previousCache: {
      version: 2,
      packs: {
        [packKey]: {
          pack_identity: identity,
          hash: "hash_abc",
          event_ids: ["a", "b", "c"],
          saved_at_utc: "2026-03-15T00:00:00.000Z",
        },
      },
    },
    savedAtUtc: "2026-03-16T00:00:00.000Z",
  });
  assert.strictEqual(fourth.deterministic.comparison_scope, "same_pack_identity");
  assert.strictEqual(fourth.deterministic.compared_with_previous_same_identity, true);
  assert.strictEqual(fourth.deterministic.match_pct, 2 / 3);
  assert.deepStrictEqual(fourth.deterministic.diff_files, ["qa/diff/event_id_diff.json"]);
  assert.ok(fourth.deterministicDiff);
})();

console.log("IMPROVEMENT_PACK_DETERMINISM_TEST_OK");
