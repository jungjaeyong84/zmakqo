#!/usr/bin/env node
"use strict";

// Phase 3d — SL/TP1/trail parameter grid search.
//
// Purpose:
//   The 2026-04-17 diagnosis showed:
//     - Event-truth positive rate 63% but PnL -49 (payoff asymmetry).
//     - TP1 first rate 7~20% vs SL first rate 51%.
//     - SL 1.65% / TP1 3.25% current contract may be structurally imbalanced.
//   This tool sweeps a grid of (SL, TP1, TP1_QTY, TRAIL_R) over a list of
//   historical trade episodes and computes realised PnL per combo so the
//   operator can pick a less-lossy exit contract.
//
// Input shape (each episode):
//   {
//     "symbol": "BTCUSDT",
//     "side": "LONG",           // or "SHORT"
//     "entry_price": 50000,
//     "leverage": 2,
//     "entry_qty_abs": 0.02,
//     "bar_close_ms": 1700000000000,
//     "path": [                 // 1m bars from entry bar close onward
//       { "high": 50120, "low": 49950, "close": 50050, "ms": 1700000060000 },
//       ...
//     ]
//   }
//
// Input sources:
//   --fixture <path>   Load episodes from a JSON file (preferred for CI).
//   --synthetic        Generate a deterministic synthetic set (default when
//                      no input is given). Useful for regression tests.
//
// Output: stdout JSON { combos: [{params, stats}] } sorted by objective.
//         ops/daily/exit_params_grid_latest.json when run with --write.
//
// This script does NOT touch Firestore. To feed it real fills+path data,
// export the trades first via a separate (Firestore-aware) loader; that
// keeps this grid runner portable and CI-safe.

const fs = require("fs");
const path = require("path");
const {
  buildSimplifiedExitPlan,
  computeSimplifiedTrailingStop,
} = require("../src/services/simplifiedExitV2");

const REPO_ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = String(argv[i] || "");
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val == null || String(val).startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = val;
    i += 1;
  }
  return out;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cartesian(grid) {
  // grid: { sl: [..], tp1: [..], tp1Qty: [..], trailR: [..] }
  const out = [];
  for (const sl of grid.sl) {
    for (const tp1 of grid.tp1) {
      for (const tp1Qty of grid.tp1Qty) {
        for (const trailR of grid.trailR) {
          out.push({ sl, tp1, tp1Qty, trailR });
        }
      }
    }
  }
  return out;
}

// Simulate one episode against one parameter combo.
// Returns { outcome, realised_ret_net, tp1_first, sl_first }.
function simulateEpisode(episode, combo) {
  const side = String(episode.side || "LONG").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
  const entryPrice = Number(episode.entry_price);
  const leverage = Number(episode.leverage || 1);
  const entryQtyAbs = Number(episode.entry_qty_abs || 1);
  if (!(entryPrice > 0) || !(entryQtyAbs > 0)) {
    return { outcome: "INVALID", realised_ret_net: 0 };
  }
  const plan = buildSimplifiedExitPlan({
    side,
    entryPrice,
    entryQtyAbs,
    qtyStep: 0,
    minQty: 0,
    minNotional: 0,
    tp1QtyRatio: combo.tp1Qty,
    tp1TargetPct: combo.tp1 / 100,
    stopLossPct: combo.sl / 100,
    floorLockPct: 0.0025,
    trailPct: 0.01,
  });
  if (!plan.ok) return { outcome: "PLAN_INVALID", realised_ret_net: 0 };

  const tp1Price = plan.tp1_target_price;
  const slPrice = plan.initial_stop_price;
  const tp1Qty = plan.tp1_target_qty_abs;
  const runnerQty = plan.runner_qty_abs;
  const path = Array.isArray(episode.path) ? episode.path : [];
  if (!path.length) return { outcome: "NO_PATH", realised_ret_net: 0 };

  let tp1Hit = false;
  let tp1Bar = -1;
  let trailHigh = entryPrice;
  let trailLow = entryPrice;
  let stopPrice = slPrice;
  let tp1FirstCandidate = false;
  let slFirstCandidate = false;

  for (let i = 0; i < path.length; i += 1) {
    const bar = path[i];
    const hi = Number(bar.high);
    const lo = Number(bar.low);
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) continue;

    if (!tp1Hit) {
      // Before TP1: check both SL and TP1 on this bar.
      const slHit = side === "LONG" ? lo <= slPrice : hi >= slPrice;
      const tpHit = side === "LONG" ? hi >= tp1Price : lo <= tp1Price;
      // Intrabar order: worst case for us — assume SL first if both triggered.
      if (slHit && !tpHit) {
        slFirstCandidate = true;
        // Full exit at SL.
        const realised = side === "LONG"
          ? (slPrice - entryPrice) / entryPrice
          : (entryPrice - slPrice) / entryPrice;
        return {
          outcome: "SL_FIRST",
          realised_ret_net: realised * leverage,
          tp1_first: false,
          sl_first: true,
          bars_to_exit: i + 1,
        };
      }
      if (tpHit && !slHit) {
        tp1FirstCandidate = true;
        tp1Hit = true;
        tp1Bar = i;
      }
      if (tpHit && slHit) {
        // Both hit this bar — conservative: SL first.
        slFirstCandidate = true;
        const realised = side === "LONG"
          ? (slPrice - entryPrice) / entryPrice
          : (entryPrice - slPrice) / entryPrice;
        return {
          outcome: "SL_TIE",
          realised_ret_net: realised * leverage,
          tp1_first: false,
          sl_first: true,
          bars_to_exit: i + 1,
        };
      }
      continue;
    }

    // Post TP1 — trailing on the runner.
    trailHigh = Math.max(trailHigh, hi);
    trailLow = Math.min(trailLow, lo);
    const trail = computeSimplifiedTrailingStop({
      side,
      entryPrice,
      currentPrice: (hi + lo) / 2,
      trailPct: combo.trailR > 0 ? Math.min(0.05, (combo.sl / 100) * combo.trailR) : 0.01,
      floorLockPct: 0.0025,
      trailHighPrice: trailHigh,
      trailLowPrice: trailLow,
      currentStopPrice: stopPrice,
    });
    if (trail && Number.isFinite(trail.final_effective_stop)) {
      stopPrice = trail.final_effective_stop;
    }
    const stopHit = side === "LONG" ? lo <= stopPrice : hi >= stopPrice;
    if (stopHit) {
      // TP1 half already realised + runner exits at stopPrice.
      const tp1Return = side === "LONG"
        ? (tp1Price - entryPrice) / entryPrice
        : (entryPrice - tp1Price) / entryPrice;
      const runnerReturn = side === "LONG"
        ? (stopPrice - entryPrice) / entryPrice
        : (entryPrice - stopPrice) / entryPrice;
      const weighted = (tp1Return * (tp1Qty / entryQtyAbs)) + (runnerReturn * (runnerQty / entryQtyAbs));
      return {
        outcome: "TRAIL_FINAL",
        realised_ret_net: weighted * leverage,
        tp1_first: tp1FirstCandidate,
        sl_first: false,
        bars_to_exit: i + 1,
        tp1_bar: tp1Bar,
      };
    }
  }

  // Ran out of bars — mark open and book at last close for runner.
  const lastBar = path[path.length - 1];
  const lastClose = Number(lastBar.close || (lastBar.high + lastBar.low) / 2);
  if (tp1Hit) {
    const tp1Return = side === "LONG"
      ? (tp1Price - entryPrice) / entryPrice
      : (entryPrice - tp1Price) / entryPrice;
    const runnerReturn = side === "LONG"
      ? (lastClose - entryPrice) / entryPrice
      : (entryPrice - lastClose) / entryPrice;
    const weighted = (tp1Return * (tp1Qty / entryQtyAbs)) + (runnerReturn * (runnerQty / entryQtyAbs));
    return {
      outcome: "OPEN_RUNNER",
      realised_ret_net: weighted * leverage,
      tp1_first: tp1FirstCandidate,
      sl_first: false,
      bars_to_exit: path.length,
    };
  }
  const unrealised = side === "LONG"
    ? (lastClose - entryPrice) / entryPrice
    : (entryPrice - lastClose) / entryPrice;
  return {
    outcome: "OPEN_NO_TP1",
    realised_ret_net: unrealised * leverage,
    tp1_first: false,
    sl_first: false,
    bars_to_exit: path.length,
  };
}

function simulateGrid(episodes, grid) {
  const combos = cartesian(grid);
  const results = [];
  for (const combo of combos) {
    let winN = 0;
    let lossN = 0;
    let tp1FirstN = 0;
    let slFirstN = 0;
    let totalRet = 0;
    let absRet = 0;
    const episodeN = episodes.length;
    for (const ep of episodes) {
      const r = simulateEpisode(ep, combo);
      totalRet += r.realised_ret_net;
      absRet += Math.abs(r.realised_ret_net);
      if (r.realised_ret_net > 0) winN += 1;
      else if (r.realised_ret_net < 0) lossN += 1;
      if (r.tp1_first) tp1FirstN += 1;
      if (r.sl_first) slFirstN += 1;
    }
    results.push({
      params: combo,
      episode_n: episodeN,
      win_n: winN,
      loss_n: lossN,
      tp1_first_n: tp1FirstN,
      sl_first_n: slFirstN,
      tp1_first_rate: episodeN ? tp1FirstN / episodeN : 0,
      sl_first_rate: episodeN ? slFirstN / episodeN : 0,
      win_rate: episodeN ? winN / episodeN : 0,
      avg_ret_net: episodeN ? totalRet / episodeN : 0,
      total_ret_net: totalRet,
      profit_factor: absRet - totalRet > 0 ? (absRet + totalRet) / (absRet - totalRet) : null,
    });
  }
  // Sort by total_ret_net desc.
  results.sort((a, b) => b.total_ret_net - a.total_ret_net);
  return results;
}

function seededRandom(seed) {
  let s = Math.floor(seed) % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function buildSyntheticEpisodes(count = 60, { seed = 7, entryPrice = 50000 } = {}) {
  const rnd = seededRandom(seed);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    // Bias toward the observed regime: slight negative drift, high vol.
    const driftBps = (rnd() - 0.55) * 20; // bps per bar
    const vol = 0.0022 + rnd() * 0.0040; // per-bar stdev ~ 22~62 bps
    const bars = 180; // 3 hours of 1m bars
    const side = rnd() > 0.5 ? "LONG" : "SHORT";
    const path = [];
    let price = entryPrice;
    let high = price;
    let low = price;
    for (let b = 0; b < bars; b += 1) {
      const move = (driftBps / 10000) + (rnd() - 0.5) * vol;
      price = price * (1 + move);
      high = Math.max(high, price * (1 + rnd() * vol * 0.5));
      low = Math.min(low, price * (1 - rnd() * vol * 0.5));
      path.push({ high, low, close: price, ms: b * 60000 });
      high = price;
      low = price;
    }
    out.push({
      symbol: "SYNTH" + i,
      side,
      entry_price: entryPrice,
      leverage: 2,
      entry_qty_abs: 1,
      bar_close_ms: 0,
      path,
    });
  }
  return out;
}

function loadFixture(fixturePath) {
  const abs = path.isAbsolute(fixturePath) ? fixturePath : path.join(REPO_ROOT, fixturePath);
  const raw = JSON.parse(fs.readFileSync(abs, "utf8"));
  if (!Array.isArray(raw)) throw new Error("FIXTURE_MUST_BE_ARRAY_OF_EPISODES");
  return raw;
}

function defaultGrid() {
  return {
    sl: [1.2, 1.4, 1.65, 1.9, 2.2],
    tp1: [2.0, 2.5, 3.0, 3.25, 4.0],
    tp1Qty: [0.375, 0.5],
    trailR: [0.6, 0.9, 1.2, 1.5],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let episodes;
  if (args.fixture) {
    episodes = loadFixture(String(args.fixture));
  } else {
    // Synthetic mode is the safe default so this script can run in CI / PR
    // review without production data access. The operator runs
    //   node scripts/backtest-exit-params-grid.js --fixture <path>
    // once they have exported real episodes.
    episodes = buildSyntheticEpisodes(Number(args.n) || 60, { seed: Number(args.seed) || 7 });
  }

  const grid = defaultGrid();
  const results = simulateGrid(episodes, grid);
  const top = results.slice(0, Math.max(1, Number(args.top) || 12));
  const payload = {
    ok: true,
    generated_at: new Date().toISOString(),
    mode: args.fixture ? "FIXTURE" : "SYNTHETIC",
    fixture_path: args.fixture ? String(args.fixture) : null,
    episode_n: episodes.length,
    grid,
    top_combos: top,
    current_contract: {
      sl: 1.65,
      tp1: 3.25,
      tp1Qty: 0.375,
      trailR: 0.9,
    },
  };
  if (args.write) {
    const outDir = path.join(REPO_ROOT, "ops", "daily");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "exit_params_grid_latest.json"), JSON.stringify(payload, null, 2));
  }
  console.log(JSON.stringify(payload, null, 2));
  return payload;
}

if (require.main === module) {
  main().catch((err) => {
    console.error("BACKTEST_EXIT_PARAMS_GRID_FAIL", err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    simulateEpisode,
    simulateGrid,
    buildSyntheticEpisodes,
    defaultGrid,
    __test: {
      seededRandom,
      cartesian,
    },
  };
}
