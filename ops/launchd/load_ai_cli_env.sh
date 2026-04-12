#!/bin/zsh

export PATH="$HOME/.local/bin:$PATH"
export CODEX_BIN="${CODEX_BIN:-/Applications/Codex.app/Contents/Resources/codex}"
export CLAUDE_CLI_CMD="${CLAUDE_CLI_CMD:-$HOME/.local/bin/claude}"
export CLAUDE_CLI_EXTRA_ARGS="${CLAUDE_CLI_EXTRA_ARGS:---model sonnet --permission-mode acceptEdits}"
export CODEX_FALLBACK_LOG_PATH="${CODEX_FALLBACK_LOG_PATH:-$HOME/.codex/logs/codex-fallback.log}"
export FALLBACK_PATTERNS="${FALLBACK_PATTERNS:-(usage limit|rate limit|too many requests|429|quota|insufficient[_ -]?quota|token budget|context window|maximum context|max(imum)? tokens|billing|credit balance|exceeded.*limit|model is overloaded|try again later)}"
