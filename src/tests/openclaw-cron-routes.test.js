"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const routeSource = fs.readFileSync(path.resolve(__dirname, "../routes/openclaw.cron.routes.js"), "utf8");

assert.ok(routeSource.includes("/api/openclaw/cron/v2-production-entry-route-canary"), "v2 production route canary endpoint missing");
assert.ok(routeSource.includes("run-v2-production-entry-route-canary"), "v2 production route canary script binding missing");
assert.ok(routeSource.includes("v2_production_entry_route_canary"), "v2 production route canary timeout label missing");
assert.ok(routeSource.includes("/api/openclaw/cron/v2-exit-runtime-canary"), "v2 exit runtime canary endpoint missing");
assert.ok(routeSource.includes("run-v2-exit-runtime-canary"), "v2 exit runtime canary script binding missing");
assert.ok(routeSource.includes("v2_exit_runtime_canary"), "v2 exit runtime canary timeout label missing");
assert.ok(routeSource.includes("/api/openclaw/cron/v2-active-protection-reconciliation"), "v2 active protection reconciliation endpoint missing");
assert.ok(routeSource.includes("check-v2-active-protection-reconciliation"), "v2 active protection reconciliation script binding missing");
assert.ok(routeSource.includes("v2_active_protection_reconciliation"), "v2 active protection reconciliation timeout label missing");
assert.ok(routeSource.includes("/api/openclaw/cron/v2-fill-sync"), "v2 fill sync endpoint missing");
assert.ok(routeSource.includes("syncBinanceFuturesFills"), "v2 fill sync script binding missing");
assert.ok(routeSource.includes("v2_fill_sync"), "v2 fill sync timeout label missing");
assert.ok(routeSource.includes("/api/openclaw/cron/openclaw-server-primary-tick"), "server primary tick endpoint missing");
assert.ok(routeSource.includes("run-openclaw-server-primary-tick"), "server primary tick script binding missing");
assert.ok(routeSource.includes("openclaw_server_primary_tick"), "server primary tick timeout label missing");
assert.ok(
  /openclaw_server_primary_tick[\s\S]{0,260}300000/.test(routeSource),
  "server primary tick route timeout must allow 16-symbol warmup ticks"
);
assert.ok(routeSource.includes("/api/openclaw/cron/v2-signal-shadow-counterfactual-walker"), "shadow counterfactual walker endpoint missing");
assert.ok(routeSource.includes("walk-v2-signal-shadow-counterfactual-ledger"), "shadow counterfactual walker script binding missing");
assert.ok(routeSource.includes("v2_signal_shadow_counterfactual_walker"), "shadow counterfactual walker timeout label missing");
assert.ok(routeSource.includes("/api/openclaw/cron/v2-signal-shadow-counterfactual-analyzer"), "shadow counterfactual analyzer endpoint missing");
assert.ok(routeSource.includes("analyze-v2-signal-shadow-counterfactuals"), "shadow counterfactual analyzer script binding missing");
assert.ok(routeSource.includes("v2_signal_shadow_counterfactual_analyzer"), "shadow counterfactual analyzer timeout label missing");
assert.ok(routeSource.includes("/api/openclaw/cron/v2-liquidation-stream-collector-window"), "liquidation stream collector window endpoint missing");
assert.ok(routeSource.includes("run-v2-liquidation-stream-collector-window"), "liquidation stream collector window script binding missing");
assert.ok(routeSource.includes("v2_liquidation_stream_collector_window"), "liquidation stream collector window timeout label missing");
assert.ok(routeSource.includes("outcome.result && outcome.result.ok === true"), "route must fail HTTP status when canary result is blocked");
assert.ok(routeSource.includes("POST /api/openclaw/cron/v2-production-entry-route-canary"), "ping route list must expose canary endpoint");
assert.ok(routeSource.includes("POST /api/openclaw/cron/v2-exit-runtime-canary"), "ping route list must expose exit runtime canary endpoint");
assert.ok(routeSource.includes("POST /api/openclaw/cron/v2-active-protection-reconciliation"), "ping route list must expose active protection reconciliation endpoint");
assert.ok(routeSource.includes("POST /api/openclaw/cron/v2-fill-sync"), "ping route list must expose fill sync endpoint");
assert.ok(routeSource.includes("POST /api/openclaw/cron/openclaw-server-primary-tick"), "ping route list must expose server primary tick endpoint");
assert.ok(routeSource.includes("POST /api/openclaw/cron/v2-signal-shadow-counterfactual-walker"), "ping route list must expose walker endpoint");
assert.ok(routeSource.includes("POST /api/openclaw/cron/v2-signal-shadow-counterfactual-analyzer"), "ping route list must expose analyzer endpoint");
assert.ok(routeSource.includes("POST /api/openclaw/cron/v2-liquidation-stream-collector-window"), "ping route list must expose liquidation collector endpoint");

console.log("OPENCLAW_CRON_ROUTES_TEST_OK");
