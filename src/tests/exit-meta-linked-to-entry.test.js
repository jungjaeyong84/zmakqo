"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperBinanceRunner");

const { isExitMetaLinkedToEntry } = __test;

(() => {
  // Same entry id and matching exec ms: linked.
  assert.strictEqual(
    isExitMetaLinkedToEntry({
      entryEventId: "BINANCEFUT|LINKUSDT|15m|123|ENTRY",
      exitEntryEventId: "BINANCEFUT|LINKUSDT|15m|123|ENTRY",
      entryExecMs: 1_700_000_000_000,
      exitEntryExecMs: 1_700_000_000_000,
      exitAtMs: 1_700_000_300_000,
    }),
    true,
    "matching id+exec ms should link",
  );

  // Different ids: unlinked.
  assert.strictEqual(
    isExitMetaLinkedToEntry({
      entryEventId: "BINANCEFUT|LINKUSDT|15m|999|ENTRY",
      exitEntryEventId: "BINANCEFUT|LINKUSDT|15m|111|ENTRY",
      entryExecMs: 1_700_000_000_000,
      exitEntryExecMs: 1_699_900_000_000,
    }),
    false,
    "mismatched ids should not link",
  );

  // Exec ms drift > 1000ms: unlinked.
  assert.strictEqual(
    isExitMetaLinkedToEntry({
      entryEventId: "X",
      exitEntryEventId: "X",
      entryExecMs: 1_700_000_000_000,
      exitEntryExecMs: 1_700_000_005_000,
    }),
    false,
    "drifted exec ms should not link",
  );

  // Exit timestamp predates entry by >30s: unlinked.
  assert.strictEqual(
    isExitMetaLinkedToEntry({
      entryEventId: "X",
      entryExecMs: 1_700_000_000_000,
      exitAtMs: 1_699_999_900_000,
    }),
    false,
    "exit before entry should not link",
  );

  // ───────────────────────────────────────────────────────────────────────
  // The LINK regression: tp_p1_done leaked from a prior cycle. Old writers
  // omitted tp_p1_entry_event_id / tp_p1_entry_exec_bar_ms / tp_p1_at, so the
  // pre-patch check defaulted to "linked" and the auto-heal never fired.
  // The hardened check must now treat any exit ledger flag with NO lineage
  // proof as unlinked once the entry side carries any lineage.
  // ───────────────────────────────────────────────────────────────────────
  assert.strictEqual(
    isExitMetaLinkedToEntry({
      entryEventId: "BINANCEFUT|LINKUSDT|15m|2026|ENTRY",
      exitEntryEventId: null,
      entryExecMs: 1_700_000_000_000,
      exitEntryExecMs: null,
      exitAtMs: null,
    }),
    false,
    "lineage-less exit ledger flag with entry id present must be treated as unlinked",
  );

  assert.strictEqual(
    isExitMetaLinkedToEntry({
      entryEventId: null,
      exitEntryEventId: null,
      entryExecMs: 1_700_000_000_000,
      exitEntryExecMs: null,
      exitAtMs: null,
    }),
    false,
    "entry-exec-ms-only entry vs lineage-less exit must not link",
  );

  // Conservative: when neither side has any lineage at all, do NOT force unlink.
  // (This mirrors the legacy default — no information either way.)
  assert.strictEqual(
    isExitMetaLinkedToEntry({}),
    true,
    "fully empty inputs should retain legacy default (linked)",
  );

  // Lineage-less entry + lineage-less exit: still linked (legacy default
  // preserved — no proof of mismatch).
  assert.strictEqual(
    isExitMetaLinkedToEntry({
      entryEventId: null,
      exitEntryEventId: null,
    }),
    true,
    "lineage-less on both sides preserves legacy default",
  );
})();

console.log("EXIT_META_LINKED_TO_ENTRY_TEST_OK");
