"use strict";

async function updateAlgoEndpointDegradationState() {
  return {
    ok: true,
    skipped: true,
    reason: "LEGACY_V2_STATE_DISABLED",
  };
}

module.exports = Object.freeze({
  updateAlgoEndpointDegradationState,
});
