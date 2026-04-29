"use strict";

// 2026-04-29 P1-1.4 — fourth stateless-helper extraction from
// src/engine/paperBinanceRunner.js.
//
// Two telegram-channel-list helpers historically lived inline in
// paperBinanceRunner.js (lines 1529 + 1536). They are pure
// (string parsing, no I/O). The runner is the first caller to
// migrate to the shared module; the same helper has at least
// FIVE other sibling copies elsewhere (audited 2026-04-29):
//
//   src/utils/alerts.js                 (private parseChannelList)
//   src/scheduler/scheduler.js          (private filterTelegramChannels)
//   src/services/signalLifecycleAlert.js (private filterTelegramChannels)
//   src/services/binanceFuturesFillsSync.js (private filterTelegramChannels)
//   src/services/tradeExecutionAlert.js (private filterTelegramChannels)
//   src/services/aiAllocation.js        (private parseChannelList + filterTelegramChannels)
//
// All five sibling implementations have identical bodies (verified
// by grep + diff on 2026-04-29). Each was copy-pasted ad-hoc as
// the codebase grew. P1-1.4 only migrates the runner's copy to
// this canonical module so the seam exists; subsequent
// audit-driven sub-steps will collapse the five sibling
// duplicates one-at-a-time. Doing them in one commit would
// stack five independent risk surfaces; the runner copy is
// pulled out first because the runner is the file we are
// actively splitting.

// parseChannelList — split a comma- or newline-separated channel
// list (env var, settings string, etc.) into a deduped trimmed
// array. Empty entries dropped. Identical semantics to the
// previous inline definition.
function parseChannelList(raw) {
  return String(raw || "")
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

// filterTelegramChannels — keep only telegram-protocol entries
// (telegram:..., tg:..., telegram://...) from a channel list,
// re-joined into a comma-separated string. Used by alert dispatch
// when the operator has set "telegram-only" mode.
function filterTelegramChannels(raw) {
  return parseChannelList(raw)
    .filter((v) => /^telegram:|^tg:|^telegram:\/\//i.test(String(v || "").trim()))
    .join(",");
}

module.exports = {
  parseChannelList,
  filterTelegramChannels,
};
