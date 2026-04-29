"use strict";

// 2026-04-29 P1-1.4 — channel-list helper extraction unit tests.
//
// Two telegram channel-list helpers extracted from
// src/engine/paperBinanceRunner.js into src/utils/channelList.js
// with no behavioural change. The tests below pin the contract
// from the new module's perspective so future audit-driven
// migrations of the five remaining sibling duplicates (in
// alerts.js, scheduler.js, signalLifecycleAlert.js,
// binanceFuturesFillsSync.js, tradeExecutionAlert.js,
// aiAllocation.js) can use this module as the canonical source
// of truth without regressing existing alert dispatch.

const assert = require("assert");

delete require.cache[require.resolve("../utils/channelList")];
const {
  parseChannelList,
  filterTelegramChannels,
} = require("../utils/channelList");

// ── (A) parseChannelList ───────────────────────────────────────
(function testParse() {
  // Comma split.
  assert.deepStrictEqual(
    parseChannelList("a,b,c"),
    ["a", "b", "c"],
    "(A1) comma split"
  );
  // Newline split.
  assert.deepStrictEqual(
    parseChannelList("a\nb\nc"),
    ["a", "b", "c"],
    "(A2) newline split"
  );
  // Mixed delimiters.
  assert.deepStrictEqual(
    parseChannelList("a,b\nc"),
    ["a", "b", "c"],
    "(A3) mixed comma+newline"
  );
  // Trim whitespace.
  assert.deepStrictEqual(
    parseChannelList("  a  ,\n b  ,  c  "),
    ["a", "b", "c"],
    "(A4) trim per-entry"
  );
  // Drop empty.
  assert.deepStrictEqual(
    parseChannelList("a,,b,\n,c"),
    ["a", "b", "c"],
    "(A5) drop empty entries"
  );
  // Falsy → empty array.
  assert.deepStrictEqual(parseChannelList(""), [], "(A6) empty string");
  assert.deepStrictEqual(parseChannelList(null), [], "(A7) null");
  assert.deepStrictEqual(parseChannelList(undefined), [], "(A8) undefined");
  // Non-string coerced.
  assert.deepStrictEqual(
    parseChannelList(42),
    ["42"],
    "(A9) number coerced via String()"
  );
})();

// ── (B) filterTelegramChannels ─────────────────────────────────
(function testFilter() {
  // Telegram protocol forms.
  assert.strictEqual(
    filterTelegramChannels("telegram:abc,slack://x,tg:def"),
    "telegram:abc,tg:def",
    "(B1) keep telegram: and tg:, drop slack"
  );
  // telegram:// URL form.
  assert.strictEqual(
    filterTelegramChannels("telegram://token@chat,https://hooks.slack.com/x"),
    "telegram://token@chat",
    "(B2) keep telegram://, drop slack URL"
  );
  // Case-insensitive.
  assert.strictEqual(
    filterTelegramChannels("TELEGRAM:abc,TG:def"),
    "TELEGRAM:abc,TG:def",
    "(B3) case-insensitive match"
  );
  // No telegram entries → empty string.
  assert.strictEqual(
    filterTelegramChannels("slack://x,https://hooks.slack.com/y"),
    "",
    "(B4) no telegram → empty"
  );
  // Empty input → empty.
  assert.strictEqual(filterTelegramChannels(""), "", "(B5) empty");
  assert.strictEqual(filterTelegramChannels(null), "", "(B6) null");
  // Whitespace handled by parse.
  assert.strictEqual(
    filterTelegramChannels("  telegram:abc  , slack://x "),
    "telegram:abc",
    "(B7) trims before filter"
  );
  // Newline separator works for filter too.
  assert.strictEqual(
    filterTelegramChannels("telegram:abc\nslack://x\ntg:def"),
    "telegram:abc,tg:def",
    "(B8) newline separator → comma-joined output"
  );
})();

// ── (C) paperBinanceRunner internal binding still works ───────
//
// paperBinanceRunner.js does not re-export these two helpers via
// __test (no test was reading them through the runner surface),
// so the contract here is just "the runner module loads cleanly
// after the extraction" — which is implicitly verified by every
// other paperBinanceRunner.__test test in npm test passing.
(function testRunnerLoads() {
  delete require.cache[require.resolve("../engine/paperBinanceRunner")];
  const runner = require("../engine/paperBinanceRunner");
  assert.ok(runner && typeof runner === "object",
    "(C1) paperBinanceRunner still loads after channel-list extraction");
})();

console.log("CHANNEL_LIST_TEST_OK");
