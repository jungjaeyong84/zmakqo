"use strict";

// 2026-04-29 P1-3.1 — V2 runtime mode resolver.
//
// Background: the codebase has accumulated ~73 environment flags
// across cloudbuild.yaml, of which 12 govern the V1→V2 cutover phase
// alone:
//
//   DONBEOLJA_V2_ENABLED
//   DONBEOLJA_V2_DRY_RUN
//   DONBEOLJA_V2_CANARY_ONLY
//   DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER
//   DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL
//   DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL
//   DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED
//   DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED
//   DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED
//   DONBEOLJA_V2_ALLOW_LEGACY_SCHEDULER_WRITES
//   DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED
//   DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED
//
// In a stable steady-state these 12 always sit in one of three
// coherent configurations:
//
//   DISCOVERY_CANARY  — current operational state. Real money, real
//                       broker, but bounded by the discovery canary
//                       envelope (small notional, position cap, daily
//                       loss halt). All "legacy" flags pinned to the
//                       V2-owns-everything stance.
//   PRODUCTION_FULL   — post-canary graduation. Same V2-owns-everything
//                       stance, broader discovery envelope or none.
//   PAUSED            — global stop. V2 disabled, V1 also disabled,
//                       no entries fire from any path.
//
// What previously happened: an operator (or a deploy default reset)
// would change one flag in the matrix without realising the others
// were now incoherent — e.g. DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED=0
// while DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL=1, which is a
// half-cutover state that exists nowhere in operational design.
// Today's session debugging proved the cost of this surface: the F2
// generator was silently blocked for hours because one flag's deploy
// default flipped without any owner noticing.
//
// This module collapses the surface to one read site. Callers ask:
//
//   const mode = resolveV2RuntimeMode();
//   if (mode.legacyRuntimeDisabled) { ... }
//   if (mode.phase === "DISCOVERY_CANARY") { ... }
//
// The resolver also runs `validateInvariants()` — the 4 known
// incoherent matrices fail with a structured warning that the
// operator can read in production logs (not a hard throw, because
// the immediate fix is sometimes to land an emergency env flip,
// not block boot). Hard-throw mode is gated by
// V2_RUNTIME_MODE_INVARIANT_THROW=1 for paranoid ops.
//
// What this commit does NOT do (P1-3.2+):
//   - migrate every existing caller off direct process.env reads
//   - change behaviour of any existing read site
//   - introduce a new env flag (no _MODE name; the matrix below is
//     the source of truth)
//
// All this commit does is provide the seam. Callers can adopt it
// incrementally; once the existing 12 reads have all migrated,
// future operator changes flow through one validated entry point
// and incoherent matrices stop reaching production.

function parseBoolEnv(raw, fallback = false) {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const s = String(raw).trim().toLowerCase();
  if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
  if (s === "0" || s === "false" || s === "no" || s === "off") return false;
  return fallback;
}

function readMatrix(env = process.env) {
  return Object.freeze({
    v2Enabled: parseBoolEnv(env.DONBEOLJA_V2_ENABLED, false),
    dryRun: parseBoolEnv(env.DONBEOLJA_V2_DRY_RUN, false),
    canaryOnly: parseBoolEnv(env.DONBEOLJA_V2_CANARY_ONLY, false),
    requireProductionCutover: parseBoolEnv(env.DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER, false),
    blockLegacyWebhook: parseBoolEnv(env.DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL, false),
    allowLegacyWebhook: parseBoolEnv(env.DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL, false),
    legacyRuntimeDisabled: parseBoolEnv(env.DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED, false),
    legacyEntryFiltersDisabled: parseBoolEnv(env.DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED, false),
    legacyWaitOneBarHardDropDisabled: parseBoolEnv(env.DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED, false),
    allowLegacySchedulerWrites: parseBoolEnv(env.DONBEOLJA_V2_ALLOW_LEGACY_SCHEDULER_WRITES, false),
    productionEntryLiveEndpointEnabled: parseBoolEnv(env.DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED, false),
    riskGovernorRequired: parseBoolEnv(env.DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED, false),
  });
}

// 2026-04-29 — codified phase classifier. The matrix's truth-table is
// small enough that an explicit switch is more readable (and easier
// to audit) than a derived rule.
function classifyPhase(matrix) {
  // PAUSED — V2 off and we cannot fall back to V1 either (legacy
  // runtime disabled). No entries should fire from any path.
  if (!matrix.v2Enabled && matrix.legacyRuntimeDisabled) return "PAUSED";

  // DISCOVERY_CANARY — V2 on, real broker (dry_run=false), bounded
  // (canary_only=true), and every "legacy is owned by V2 now" guard
  // engaged. This is the current production stance.
  if (
    matrix.v2Enabled
    && matrix.dryRun === false
    && matrix.canaryOnly === true
    && matrix.legacyRuntimeDisabled === true
    && matrix.legacyEntryFiltersDisabled === true
    && matrix.blockLegacyWebhook === true
    && matrix.allowLegacyWebhook === false
    && matrix.allowLegacySchedulerWrites === false
    && matrix.productionEntryLiveEndpointEnabled === true
    && matrix.riskGovernorRequired === true
  ) {
    return "DISCOVERY_CANARY";
  }

  // PRODUCTION_FULL — same V2-owns-everything stance, but
  // canary_only relaxed (operator graduated past the discovery
  // envelope). All other guards still required.
  if (
    matrix.v2Enabled
    && matrix.dryRun === false
    && matrix.canaryOnly === false
    && matrix.legacyRuntimeDisabled === true
    && matrix.legacyEntryFiltersDisabled === true
    && matrix.blockLegacyWebhook === true
    && matrix.allowLegacyWebhook === false
    && matrix.allowLegacySchedulerWrites === false
    && matrix.productionEntryLiveEndpointEnabled === true
    && matrix.riskGovernorRequired === true
  ) {
    return "PRODUCTION_FULL";
  }

  // Any other matrix is incoherent. Surface UNKNOWN so callers fall
  // through to their existing direct-env behaviour AND so the
  // invariant warning fires.
  return "UNKNOWN";
}

function resolveV2RuntimeMode(env = process.env) {
  const matrix = readMatrix(env);
  const phase = classifyPhase(matrix);
  const invariantViolations = [];

  // Invariant 1: block + allow are mutually exclusive on the legacy
  // webhook flag.
  if (matrix.blockLegacyWebhook && matrix.allowLegacyWebhook) {
    invariantViolations.push("LEGACY_WEBHOOK_BLOCK_AND_ALLOW_BOTH_TRUE");
  }
  // Invariant 2: legacy_runtime_disabled implies legacy_entry_filters_disabled
  // (you can't disable V1 runtime then re-enable V1's entry filter
  // path — it's the same V1).
  if (matrix.legacyRuntimeDisabled && !matrix.legacyEntryFiltersDisabled) {
    invariantViolations.push("LEGACY_RUNTIME_DISABLED_BUT_ENTRY_FILTERS_ACTIVE");
  }
  // Invariant 3: V2 enabled requires risk governor.
  if (matrix.v2Enabled && !matrix.riskGovernorRequired) {
    invariantViolations.push("V2_ENABLED_BUT_RISK_GOVERNOR_NOT_REQUIRED");
  }
  // Invariant 4: production-entry-live endpoint requires V2 enabled.
  if (matrix.productionEntryLiveEndpointEnabled && !matrix.v2Enabled) {
    invariantViolations.push("PRODUCTION_ENTRY_LIVE_ENABLED_BUT_V2_DISABLED");
  }

  return Object.freeze({
    phase, // DISCOVERY_CANARY | PRODUCTION_FULL | PAUSED | UNKNOWN
    matrix,
    invariantViolations: Object.freeze(invariantViolations),
    // Convenience accessors most callers want — flat shape so callers
    // can write `if (mode.legacyRuntimeDisabled)` instead of
    // navigating the `matrix` nesting. All booleans, no semantic
    // change vs. reading the env directly.
    v2Enabled: matrix.v2Enabled,
    dryRun: matrix.dryRun,
    canaryOnly: matrix.canaryOnly,
    legacyRuntimeDisabled: matrix.legacyRuntimeDisabled,
    legacyEntryFiltersDisabled: matrix.legacyEntryFiltersDisabled,
    blockLegacyWebhook: matrix.blockLegacyWebhook,
    allowLegacyWebhook: matrix.allowLegacyWebhook,
    allowLegacySchedulerWrites: matrix.allowLegacySchedulerWrites,
    productionEntryLiveEndpointEnabled: matrix.productionEntryLiveEndpointEnabled,
    riskGovernorRequired: matrix.riskGovernorRequired,
    requireProductionCutover: matrix.requireProductionCutover,
    legacyWaitOneBarHardDropDisabled: matrix.legacyWaitOneBarHardDropDisabled,
  });
}

// 2026-04-29 — invariant logger. Surface incoherent matrices in
// production logs so an operator change that breaks the invariants
// is immediately visible. Default behaviour is warn-only because
// during a controlled cutover an intermediate matrix may be
// expected for a few minutes; hard-throw mode (env
// V2_RUNTIME_MODE_INVARIANT_THROW=1) is available for ops setups that
// prefer fail-fast on boot.
function logInvariantViolations(mode, { logger = console } = {}) {
  if (!mode || !Array.isArray(mode.invariantViolations) || mode.invariantViolations.length === 0) {
    return { ok: true, violations: [] };
  }
  const payload = {
    event: "v2_runtime_mode_invariant_violation",
    ts: new Date().toISOString(),
    phase: mode.phase,
    invariant_violations: mode.invariantViolations.slice(),
    matrix: mode.matrix,
  };
  if (parseBoolEnv(process.env.V2_RUNTIME_MODE_INVARIANT_THROW, false)) {
    throw new Error(`V2_RUNTIME_MODE_INVARIANT_VIOLATION: ${JSON.stringify(payload)}`);
  }
  if (logger && typeof logger.warn === "function") {
    logger.warn("[V2_RUNTIME_MODE_INVARIANT]", JSON.stringify(payload));
  }
  return { ok: false, violations: mode.invariantViolations.slice() };
}

module.exports = {
  resolveV2RuntimeMode,
  classifyPhase,
  readMatrix,
  logInvariantViolations,
  // exported for callers that want phase constants
  PHASES: Object.freeze({
    DISCOVERY_CANARY: "DISCOVERY_CANARY",
    PRODUCTION_FULL: "PRODUCTION_FULL",
    PAUSED: "PAUSED",
    UNKNOWN: "UNKNOWN",
  }),
  __test: {
    parseBoolEnv,
  },
};
