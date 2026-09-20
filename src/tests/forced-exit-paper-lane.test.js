"use strict";

// The lane only ever trades what its parser recognises. A silent parser failure
// looks exactly like "no announcements this week", so the three title shapes it
// must catch — and the ones it must ignore — are pinned here with real titles
// taken from the Binance announcement feed on 2026-09-20.

const assert = require("assert");
const { parseArticle, splitTokens, symbolFor } = require("../../scripts/run-forced-exit-paper-lane");

// (A) token delisting
{
  const p = parseArticle("Binance Will Delist ACX, HFT, VANRY, VIC on 2026-08-17");
  assert.strictEqual(p.family, "token_delist", "(A1) family");
  assert.deepStrictEqual(p.tokens, ["ACX", "HFT", "VANRY", "VIC"], "(A2) every token in the list");
}

// (B) futures-only delisting: the symbol is already a perp name
{
  const p = parseArticle("Binance Futures Will Delist USDⓈ-M AERGOUSDT Perpetual Contract (2026-07-24)");
  assert.strictEqual(p.family, "futures_delist", "(B1) family");
  assert.deepStrictEqual(p.symbols, ["AERGOUSDT"], "(B2) symbol");
}

// (C) monitoring tag, including the "&" form and a trailing removal clause
{
  const p = parseArticle("Binance Will Extend the Monitoring Tag to Include AVA, GNS, SCR & TOWNS on 2026-09-04");
  assert.strictEqual(p.family, "monitoring_tag", "(C1) family");
  assert.deepStrictEqual(p.tokens, ["AVA", "GNS", "SCR", "TOWNS"], "(C2) tokens");

  const q = parseArticle("Binance Will Extend the Monitoring Tag to Include ALCX & COOKIE, Remove the Monitoring Tag for DODO on 2026-05-22");
  assert.deepStrictEqual(q.tokens, ["ALCX", "COOKIE"], "(C3) only the tokens being ADDED are traded");
}

// (D) titles that must NOT produce a trade
{
  assert.strictEqual(parseArticle("Binance Will Remove the Monitoring Tag for ZEC and the Seed Tag for ALT on 2026-03-01"), null, "(D1) tag removal is not an entry");
  assert.strictEqual(parseArticle("Notice of Removal of Spot Trading Pairs - 2026-09-18"), null, "(D2) pair removal is a different event");
  assert.strictEqual(parseArticle("Binance Will Support the Ethereum Network Upgrade"), null, "(D3) unrelated news");
}

// (E) token to perpetual mapping, including the 1000x contracts
{
  const perps = new Map([["BONKUSDT", 1]].concat([["1000BONKUSDT", 1], ["ICXUSDT", 1]]).map(([k, v]) => [k, v]));
  assert.strictEqual(symbolFor("ICX", perps), "ICXUSDT", "(E1) plain symbol");
  assert.strictEqual(symbolFor("BONK", perps), "BONKUSDT", "(E2) exact name wins when both exist");
  assert.strictEqual(symbolFor("NOPE", perps), null, "(E3) no perp, no trade");
  const only1000 = new Map([["1000SHIBUSDT", 1]]);
  assert.strictEqual(symbolFor("SHIB", only1000), "1000SHIBUSDT", "(E4) 1000x contract is found");
}

// (F) splitTokens must not invent tokens out of dates or parentheses
{
  assert.deepStrictEqual(splitTokens("ACX, HFT (2026-08-17)"), ["ACX", "HFT"], "(F1) dates and parentheses dropped");
}

console.log("FORCED_EXIT_PAPER_LANE_TESTS_PASS");
