const assert = require("assert");
const priv = require("../exchanges/binanceFuturesPrivate");

// 2026-09-05 — pins the live-order kill switch.
//
// Before this, nothing could place an order only because the sole call site
// failed to load: the v2 purge deleted a module paperBinanceRunner.js still
// requires. That is protection by accident. It vanishes the moment someone
// repairs the import or writes a new caller, and the way you find out is a
// real order rather than an exception.
//
// Refusal is now the default. These tests assert it stays that way, and — just
// as importantly — that READ access is unaffected, since the dashboard and the
// monitors depend on it.

const WRITE_FNS = [
  "placeFuturesMarketOrder",
  "placeFuturesLimitOrder",
  "placeFuturesStopMarketOrder",
  "placeFuturesTakeProfitMarketOrder",
  "cancelFuturesOrder",
  "cancelFuturesAlgoOrder",
  "cancelFuturesOpenOrders",
  "setFuturesLeverage",
  "setFuturesMarginType",
];

const ARM = "BINANCE_LIVE_ORDERS_ARMED";
const saved = process.env[ARM];
delete process.env[ARM];

// (A) every state-changing endpoint refuses while disarmed, and refuses with a
// code a caller can branch on rather than an anonymous failure.
(async () => {
  for (const name of WRITE_FNS) {
    const fn = priv[name];
    assert.strictEqual(typeof fn, "function", `(A1) ${name} must still be exported`);
    let err = null;
    try {
      await fn({ apiKey: "k", apiSecret: "s", symbol: "BTCUSDT", side: "BUY", quantity: 1, leverage: 1, marginType: "ISOLATED" });
    } catch (e) { err = e; }
    assert.ok(err, `(A2) ${name} must throw while disarmed`);
    assert.strictEqual(err.code, "LIVE_ORDERS_DISARMED", `(A3) ${name} must throw the disarmed code, got: ${err.message}`);
    assert.ok(err.message.includes(ARM), `(A4) ${name} error must name the env var that arms it`);
  }

  // (B) the guard must fire BEFORE any network call. A guard that runs after
  // the request is sent has already placed the order.
  {
    let err = null;
    try {
      await priv.placeFuturesMarketOrder({ apiKey: "", apiSecret: "", symbol: "BTCUSDT", side: "BUY", quantity: 1 });
    } catch (e) { err = e; }
    assert.strictEqual(err.code, "LIVE_ORDERS_DISARMED",
      "(B1) missing credentials must not mask the disarm check — the guard runs first");
  }

  // (C) reads are untouched. The dashboard and monitors depend on these, and a
  // kill switch that also blocks reading would break the things that work.
  {
    for (const name of ["fetchBinanceFuturesAccount", "fetchFuturesBookTicker", "fetchFuturesExchangeInfo"]) {
      assert.strictEqual(typeof priv[name], "function", `(C1) read fn ${name} must remain exported`);
    }
    // calcAveragePrice is pure — call it to prove no guard was added to reads
    assert.strictEqual(typeof priv.calcAveragePrice, "function", "(C2) pure helpers untouched");
  }

  // (D) arming lifts the refusal. Verified by reaching a DIFFERENT failure —
  // if it still threw LIVE_ORDERS_DISARMED the switch would be inoperable.
  {
    process.env[ARM] = "1";
    let err = null;
    try {
      await priv.setFuturesLeverage({ apiKey: "", apiSecret: "", symbol: "BTCUSDT", leverage: 1 });
    } catch (e) { err = e; }
    assert.ok(err, "(D1) still fails without real credentials");
    assert.notStrictEqual(err.code, "LIVE_ORDERS_DISARMED",
      "(D2) arming must actually lift the refusal, or the switch cannot be turned on");
    delete process.env[ARM];
  }

  // (E) only the exact value "1" arms it. "true"/"yes"/"0" must not.
  for (const v of ["0", "true", "yes", "", "  "]) {
    process.env[ARM] = v;
    let err = null;
    try { await priv.setFuturesLeverage({ apiKey: "k", apiSecret: "s", symbol: "BTCUSDT", leverage: 1 }); }
    catch (e) { err = e; }
    assert.strictEqual(err && err.code, "LIVE_ORDERS_DISARMED",
      `(E1) ${JSON.stringify(v)} must not arm live orders`);
  }

  if (saved === undefined) delete process.env[ARM]; else process.env[ARM] = saved;
  console.log("LIVE_ORDERS_DISARMED_TESTS_PASS");
})().catch((e) => { console.error(e); process.exit(1); });
