#!/usr/bin/env node
"use strict";

// 2026-04-18 P1-3: pre-deploy live-integrity gate.
//
// Why this exists: `check:binance-exit-integrity-gate` is run inside the
// Cloud Build CI step with `EXIT_INTEGRITY_CI_NO_EXCHANGE_IO=1` set, which
// allows the EXCHANGE_IO validation family to be silently skipped. That
// bypass is useful (and intentional) for the CI step — the step has no
// exchange credentials and must not hang waiting for live order books. But
// it means the CI gate alone cannot answer "is the exchange-facing half of
// exit-integrity actually clean?"
//
// This script is a distinct entry point meant to run as a separate
// Cloud Build step BEFORE the deploy steps, with the CI-bypass env var
// NOT set. It also explicitly refuses to honor the bypass env var if
// someone accidentally propagates it — fail-closed.
//
// Exit codes:
//   0 = gate pass (safe to deploy)
//   1 = gate block OR bypass attempted

const { main } = require("./check-binance-exit-integrity-gate");

const CI_BYPASS_ENV = "EXIT_INTEGRITY_CI_NO_EXCHANGE_IO";

function rejectCiBypass() {
  const raw = String(process.env[CI_BYPASS_ENV] || "").trim();
  if (raw === "" || raw === "0") return;
  console.error(JSON.stringify({
    ok: false,
    reason: "LIVE_GATE_REFUSES_CI_BYPASS",
    detail: `${CI_BYPASS_ENV} is set to "${raw}" but this is the live pre-deploy gate; the CI bypass is not honored here.`,
    hint: "Unset EXIT_INTEGRITY_CI_NO_EXCHANGE_IO in this step's env and rerun. If exchange I/O cannot run in this environment, use check:binance-exit-integrity-gate (CI) and run this live gate in a separate step that has exchange credentials.",
  }));
  process.exit(1);
}

if (require.main === module) {
  rejectCiBypass();
  // Defense in depth: even if an upstream tool forgets to unset the env
  // var, scrubbing it here guarantees `shouldAllowSkippedValidationFamilies`
  // returns false for this process.
  delete process.env[CI_BYPASS_ENV];
  main().catch((err) => {
    console.error("CHECK_BINANCE_EXIT_INTEGRITY_LIVE_GATE_FAIL", err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
} else {
  module.exports = {
    rejectCiBypass,
    CI_BYPASS_ENV,
  };
}
