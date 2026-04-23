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
assert.ok(routeSource.includes("/api/openclaw/cron/openclaw-server-primary-tick"), "server primary tick endpoint missing");
assert.ok(routeSource.includes("run-openclaw-server-primary-tick"), "server primary tick script binding missing");
assert.ok(routeSource.includes("openclaw_server_primary_tick"), "server primary tick timeout label missing");
assert.ok(routeSource.includes("outcome.result && outcome.result.ok === true"), "route must fail HTTP status when canary result is blocked");
assert.ok(routeSource.includes("POST /api/openclaw/cron/v2-production-entry-route-canary"), "ping route list must expose canary endpoint");
assert.ok(routeSource.includes("POST /api/openclaw/cron/v2-exit-runtime-canary"), "ping route list must expose exit runtime canary endpoint");
assert.ok(routeSource.includes("POST /api/openclaw/cron/openclaw-server-primary-tick"), "ping route list must expose server primary tick endpoint");

console.log("OPENCLAW_CRON_ROUTES_TEST_OK");
