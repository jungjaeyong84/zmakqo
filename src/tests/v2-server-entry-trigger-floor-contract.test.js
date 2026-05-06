"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.join(__dirname, "..", "v2", "serverEntrySignalGenerator.js"),
  "utf8"
);

assert.ok(
  src.includes("reclaim_trigger_strength_min: 0.64"),
  "reclaim trigger strength minimum must be pinned to 0.64"
);

assert.ok(
  src.includes("reclaim_trigger_directional_pressure_min: 0.38"),
  "reclaim trigger directional pressure minimum must be pinned to 0.38"
);

assert.ok(
  src.includes("directionalFloorEarly: p.reclaim_trigger_directional_pressure_min"),
  "decision diagnostics must use the same early directional floor as the trigger gate"
);

console.log("V2_SERVER_ENTRY_TRIGGER_FLOOR_CONTRACT_TEST_OK");
