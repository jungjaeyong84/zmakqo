#!/bin/zsh
# Single-line phase-flip for the OpenClaw ML+AI Decision Agent.
#
# Usage:
#   ./ops/deploy/apply_openclaw_phase.sh day0       # shadow ledger only
#   ./ops/deploy/apply_openclaw_phase.sh day1       # + ml soft-gate shadow
#   ./ops/deploy/apply_openclaw_phase.sh day7       # + Codex-only narrative shadow
#   ./ops/deploy/apply_openclaw_phase.sh day10      # + conductor + retrospect (shadow)
#   ./ops/deploy/apply_openclaw_phase.sh day14      # narrative APPLY on (scale only)
#   ./ops/deploy/apply_openclaw_phase.sh day17      # conductor APPLY on (SL tighten only)
#   ./ops/deploy/apply_openclaw_phase.sh day22      # autonomy auto-degrade on
#   ./ops/deploy/apply_openclaw_phase.sh rollback   # revert all openclaw flags
#
# The script writes the selected phase env block to ~/.env.openclaw,
# prints the resulting file, and (if --restart is passed) restarts the
# local tick service so the new flags take effect immediately.
#
# Safety:
#   - Never touches the trade engine, Firestore, or the repo. Env only.
#   - V2 phases are Codex-only. The script does not write Claude CLI or
#     alternate LLM provider env, so re-running it cannot resurrect V1 AI spend.
#   - Prints the diff vs. the previous env so the operator can audit.
#   - All transitions are reversible — `rollback` removes every openclaw
#     env line and leaves the rest of ~/.env.openclaw untouched.
#   - The phase env file is sourced by ops/launchd wrappers; no product
#     code reads ~/.env.openclaw at runtime — the operator must still
#     restart the tick service for the flags to apply.

set -euo pipefail

PHASE="${1:-}"
RESTART="${2:-}"
ENV_FILE="${OPENCLAW_ENV_FILE:-$HOME/.env.openclaw}"
REPO_ROOT="${REPO_ROOT:-$HOME/Projects/donbeolja}"

if [[ -z "$PHASE" ]]; then
  echo "usage: $0 <day0|day1|day7|day10|day14|day17|day22|rollback> [--restart]" >&2
  exit 2
fi

# ───────────────────────────────────────────────────────────────────
# Env block per phase. Every block is idempotent — re-applying the
# same phase produces the same file.
# ───────────────────────────────────────────────────────────────────
case "$PHASE" in
  day0)
    PHASE_BLOCK=$(cat <<'BLOCK'
# === openclaw phase:day0 (shadow ledger only) ===
OPENCLAW_AGENT_SHADOW_ENABLED=1
OPENCLAW_EVIDENCE_LEDGER_FIRESTORE=1
OPENCLAW_NARRATIVE_PROVIDER_MODE=CODEX_CLI_ONLY
OPENCLAW_NARRATIVE_SHADOW_ONLY=1
OPENAI_CODEX_FALLBACK_ENABLED=0
BLOCK
)
    ;;
  day1)
    PHASE_BLOCK=$(cat <<'BLOCK'
# === openclaw phase:day1 (+ ml soft-gate shadow) ===
OPENCLAW_AGENT_SHADOW_ENABLED=1
OPENCLAW_EVIDENCE_LEDGER_FIRESTORE=1
OPENCLAW_ML_GATE_ENABLED=1
OPENCLAW_ML_MIN_TP1_PROB=0.22
OPENCLAW_NARRATIVE_PROVIDER_MODE=CODEX_CLI_ONLY
OPENCLAW_NARRATIVE_SHADOW_ONLY=1
OPENAI_CODEX_FALLBACK_ENABLED=0
BLOCK
)
    ;;
  day7)
    PHASE_BLOCK=$(cat <<'BLOCK'
# === openclaw phase:day7 (+ Codex-only narrative shadow) ===
OPENCLAW_AGENT_SHADOW_ENABLED=1
OPENCLAW_EVIDENCE_LEDGER_FIRESTORE=1
OPENCLAW_ML_GATE_ENABLED=1
OPENCLAW_ML_MIN_TP1_PROB=0.22
OPENCLAW_NARRATIVE_ENABLED=1
OPENCLAW_NARRATIVE_LIVE_CALL_ENABLED=1
OPENCLAW_NARRATIVE_PROVIDER_MODE=CODEX_CLI_ONLY
OPENCLAW_NARRATIVE_SHADOW_ONLY=1
OPENAI_CODEX_FALLBACK_ENABLED=0
BLOCK
)
    ;;
  day10)
    PHASE_BLOCK=$(cat <<'BLOCK'
# === openclaw phase:day10 (+ conductor + retrospect shadow) ===
OPENCLAW_AGENT_SHADOW_ENABLED=1
OPENCLAW_EVIDENCE_LEDGER_FIRESTORE=1
OPENCLAW_ML_GATE_ENABLED=1
OPENCLAW_ML_MIN_TP1_PROB=0.22
OPENCLAW_NARRATIVE_ENABLED=1
OPENCLAW_NARRATIVE_LIVE_CALL_ENABLED=1
OPENCLAW_NARRATIVE_PROVIDER_MODE=CODEX_CLI_ONLY
OPENCLAW_NARRATIVE_SHADOW_ONLY=1
OPENCLAW_CONDUCTOR_ENABLED=1
OPENCLAW_CONDUCTOR_SHADOW_ONLY=1
OPENAI_CODEX_FALLBACK_ENABLED=0
BLOCK
)
    ;;
  day14)
    PHASE_BLOCK=$(cat <<'BLOCK'
# === openclaw phase:day14 (narrative APPLY on — scale-reduce only) ===
OPENCLAW_AGENT_SHADOW_ENABLED=1
OPENCLAW_AGENT_APPLY_ENABLED=1
OPENCLAW_EVIDENCE_LEDGER_FIRESTORE=1
OPENCLAW_ML_GATE_ENABLED=1
OPENCLAW_ML_MIN_TP1_PROB=0.22
OPENCLAW_NARRATIVE_ENABLED=1
OPENCLAW_NARRATIVE_LIVE_CALL_ENABLED=1
OPENCLAW_NARRATIVE_PROVIDER_MODE=CODEX_CLI_ONLY
OPENCLAW_NARRATIVE_SHADOW_ONLY=0
OPENCLAW_CONDUCTOR_ENABLED=1
OPENCLAW_CONDUCTOR_SHADOW_ONLY=1
OPENAI_CODEX_FALLBACK_ENABLED=0
BLOCK
)
    ;;
  day17)
    PHASE_BLOCK=$(cat <<'BLOCK'
# === openclaw phase:day17 (conductor APPLY on — SL tighten only) ===
OPENCLAW_AGENT_SHADOW_ENABLED=1
OPENCLAW_AGENT_APPLY_ENABLED=1
OPENCLAW_EVIDENCE_LEDGER_FIRESTORE=1
OPENCLAW_ML_GATE_ENABLED=1
OPENCLAW_ML_MIN_TP1_PROB=0.22
OPENCLAW_NARRATIVE_ENABLED=1
OPENCLAW_NARRATIVE_LIVE_CALL_ENABLED=1
OPENCLAW_NARRATIVE_PROVIDER_MODE=CODEX_CLI_ONLY
OPENCLAW_NARRATIVE_SHADOW_ONLY=0
OPENCLAW_CONDUCTOR_ENABLED=1
OPENCLAW_CONDUCTOR_SHADOW_ONLY=0
OPENAI_CODEX_FALLBACK_ENABLED=0
BLOCK
)
    ;;
  day22)
    PHASE_BLOCK=$(cat <<'BLOCK'
# === openclaw phase:day22 (autonomy auto-degrade on) ===
OPENCLAW_AGENT_SHADOW_ENABLED=1
OPENCLAW_AGENT_APPLY_ENABLED=1
OPENCLAW_AGENT_AUTONOMY_ENABLED=1
OPENCLAW_AUTONOMY_AUTO_DEGRADE=1
OPENCLAW_AGENT_AUTONOMY_TRUST_FLOOR=0.3
OPENCLAW_EVIDENCE_LEDGER_FIRESTORE=1
OPENCLAW_ML_GATE_ENABLED=1
OPENCLAW_ML_MIN_TP1_PROB=0.22
OPENCLAW_NARRATIVE_ENABLED=1
OPENCLAW_NARRATIVE_LIVE_CALL_ENABLED=1
OPENCLAW_NARRATIVE_PROVIDER_MODE=CODEX_CLI_ONLY
OPENCLAW_NARRATIVE_SHADOW_ONLY=0
OPENCLAW_CONDUCTOR_ENABLED=1
OPENCLAW_CONDUCTOR_SHADOW_ONLY=0
OPENAI_CODEX_FALLBACK_ENABLED=0
BLOCK
)
    ;;
  rollback)
    PHASE_BLOCK=""
    ;;
  *)
    echo "unknown phase: $PHASE" >&2
    echo "valid: day0, day1, day7, day10, day14, day17, day22, rollback" >&2
    exit 2
    ;;
esac

# ───────────────────────────────────────────────────────────────────
# Rewrite ~/.env.openclaw with the new block. We strip any existing
# openclaw section (everything between "# === openclaw phase" markers,
# plus any line starting with OPENCLAW_ or OPENAI_CODEX_FALLBACK_ENABLED),
# then append the new block.
# ───────────────────────────────────────────────────────────────────
mkdir -p "$(dirname "$ENV_FILE")"
touch "$ENV_FILE"
BACKUP="${ENV_FILE}.bak.$(date +%s)"
cp "$ENV_FILE" "$BACKUP"

TMP="$(mktemp)"
# Drop every OpenClaw phase-managed line and every openclaw phase marker comment.
grep -vE '^OPENCLAW_|^OPENAI_CODEX_FALLBACK_ENABLED=|^# === openclaw phase' "$ENV_FILE" > "$TMP" || true

if [[ -n "$PHASE_BLOCK" ]]; then
  # printf is cross-shell safe (the wrapper runs under zsh in production
  # but the smoke-test harness calls it with bash).
  printf '%s\n' "$PHASE_BLOCK" >> "$TMP"
fi

mv "$TMP" "$ENV_FILE"

echo "[apply_openclaw_phase] phase=$PHASE env=$ENV_FILE backup=$BACKUP"
echo "--- ${ENV_FILE} ---"
cat "$ENV_FILE"
echo "--- diff vs backup ---"
diff -u "$BACKUP" "$ENV_FILE" || true

# ───────────────────────────────────────────────────────────────────
# Optional restart of the main server (and the tick cron, if present)
# so the new ~/.env.openclaw takes effect. The server wrapper
# `ops/launchd/run_server.sh` sources ~/.env.openclaw on boot, so a
# restart is the canonical way to pick up phase changes.
# ───────────────────────────────────────────────────────────────────
if [[ "$RESTART" == "--restart" ]]; then
  restart_agent() {
    local label="$1"
    local plist="$2"
    if [[ ! -f "$plist" ]]; then
      echo "[apply_openclaw_phase] plist missing, skipping: $plist"
      return 0
    fi
    echo "[apply_openclaw_phase] restarting $label"
    launchctl unload -w "$plist" 2>/dev/null || true
    launchctl load  -w "$plist" 2>/dev/null || true
  }

  # The product server (KeepAlive agent) — mandatory target.
  restart_agent "com.jeongjaeyong.donbeolja.server" \
    "$HOME/Library/LaunchAgents/com.jeongjaeyong.donbeolja.server.plist"

  # Legacy tick agent — optional; only if still installed.
  if launchctl list 2>/dev/null | grep -q 'com.jaeyong.donbeolja.tick'; then
    restart_agent "com.jaeyong.donbeolja.tick" \
      "$HOME/Library/LaunchAgents/com.jaeyong.donbeolja.tick.plist"
  fi
fi

echo "[apply_openclaw_phase] DONE phase=$PHASE"
