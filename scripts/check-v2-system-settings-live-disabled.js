#!/usr/bin/env node
"use strict";

const { getSystemSettingsForProvider } = require("../src/storage/settings");

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function normalizeBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function evaluateSystemSettingsLiveDisabled({ provider = "BINANCEFUT", settings = {}, source = "unknown", env = process.env } = {}) {
  const data = settings && typeof settings === "object" ? settings : {};
  const liveEnabled = data.live_enabled === true;
  const executionMode = trimOrNull(data.execution_mode) || null;
  const discoveryEnabled = normalizeBool(env.DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED, true);
  const canaryOnly = normalizeBool(env.DONBEOLJA_V2_CANARY_ONLY, true);
  const allowFormalLiveSettings = normalizeBool(env.DONBEOLJA_V2_ALLOW_SYSTEM_SETTINGS_LIVE_ENABLED, false);
  const blockers = [];

  if (discoveryEnabled && canaryOnly && liveEnabled && allowFormalLiveSettings !== true) {
    blockers.push("SYSTEM_SETTINGS:LIVE_ENABLED_MUST_BE_FALSE_FOR_DISCOVERY_CANARY");
  }

  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0
      ? "V2_SYSTEM_SETTINGS_LIVE_DISABLED_PASS"
      : "V2_SYSTEM_SETTINGS_LIVE_DISABLED_BLOCKED",
    blockers: Object.freeze(blockers),
    provider: String(provider || "BINANCEFUT").toUpperCase(),
    source,
    execution_mode: executionMode,
    live_enabled: liveEnabled,
    discovery_enabled: discoveryEnabled,
    canary_only: canaryOnly,
    allow_formal_live_settings: allowFormalLiveSettings,
  });
}

async function main(env = process.env) {
  const provider = trimOrNull(env.V2_SYSTEM_SETTINGS_PROVIDER) || "BINANCEFUT";
  const res = await getSystemSettingsForProvider(provider, 0);
  const payload = evaluateSystemSettingsLiveDisabled({
    provider,
    settings: res && res.data ? res.data : {},
    source: res && res.source ? res.source : "unknown",
    env,
  });
  const line = JSON.stringify(payload);
  if (payload.ok !== true && String(env.V2_SYSTEM_SETTINGS_LIVE_DISABLED_SOFT || "0").trim() !== "1") {
    console.error(line);
    process.exitCode = 1;
    return payload;
  }
  console.log(line);
  return payload;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_SYSTEM_SETTINGS_LIVE_DISABLED_THROWN",
      error: error && error.message ? error.message : String(error),
    }));
    process.exit(1);
  });
} else {
  module.exports = { main, __test: { evaluateSystemSettingsLiveDisabled, normalizeBool, trimOrNull } };
}
