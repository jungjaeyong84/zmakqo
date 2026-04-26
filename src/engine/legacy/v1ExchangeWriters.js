"use strict";

// LEGACY_V1_DEAD_CODE boundary.
//
// P1-7 isolates paperRunner-originated V1 exchange writers behind one
// explicit module.  The callers are still fail-closed by
// isV2DiscoveryCanaryLegacyExchangeWriteBlocked before they can reach these
// functions in V2 discovery canary, but this boundary makes any future direct
// V1 writer import auditable.

const {
  placeFuturesMarketOrder,
  placeFuturesStopMarketOrder,
  placeFuturesTakeProfitMarketOrder,
  cancelFuturesOpenOrders,
} = require("../../exchanges/binanceFuturesPrivate");

const {
  placeFuturesEntryMakerFirst,
} = require("../../services/binanceMakerFirstEntry");

module.exports = Object.freeze({
  placeFuturesMarketOrder,
  placeFuturesStopMarketOrder,
  placeFuturesTakeProfitMarketOrder,
  cancelFuturesOpenOrders,
  placeFuturesEntryMakerFirst,
});
