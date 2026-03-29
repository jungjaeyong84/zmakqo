#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/lib/firestore-recent-cache");

function main() {
  const docs = [
    { id: "a", created_at: "2026-03-25T00:00:00.000Z" },
    { id: "b", created_at: "2026-03-25T01:00:00.000Z" },
    { id: "c", updated_at: "2026-03-25T02:00:00.000Z" },
  ];
  const sorted = __test.sortDocsDesc(docs);
  assert.deepStrictEqual(sorted.map((row) => row.id), ["c", "b", "a"]);

  const merged = __test.mergeDocs(
    [{ id: "a", created_at: "2026-03-25T00:00:00.000Z", n: 1 }],
    [{ id: "a", created_at: "2026-03-25T00:00:00.000Z", n: 2 }, { id: "b", created_at: "2026-03-25T01:00:00.000Z", n: 3 }]
  );
  assert.deepStrictEqual(merged.map((row) => [row.id, row.n]), [["b", 3], ["a", 2]]);

  assert.strictEqual(__test.resolveCreatedCursor({ created_at: "2026-03-25T03:00:00.000Z" }), "2026-03-25T03:00:00.000Z");
  console.log("FIRESTORE_RECENT_CACHE_TEST_OK");
}

main();
