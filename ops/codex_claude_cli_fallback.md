# Codex -> Claude CLI Fallback

## Purpose

When the local `codex` command fails due to quota, token budget, rate limit, or similar capacity errors, automatically fall back to Claude CLI instead of stopping the workflow.

## Installed Paths

- Wrapper: `/Users/jeongjaeyong/.local/bin/codex-with-fallback`
- Shell hook: `/Users/jeongjaeyong/.zshrc`
- Claude CLI: `/Users/jeongjaeyong/.local/bin/claude`
- Codex CLI: `/Applications/Codex.app/Contents/Resources/codex`

## Runtime Behavior

`codex` is a shell function that calls `codex-with-fallback`.

Wrapper flow:

1. Run real Codex CLI.
2. Capture stderr.
3. If stderr matches fallback patterns such as quota/rate-limit/token-budget/context-limit, invoke Claude CLI.
4. Forward original CLI arguments to Claude.
5. Optionally prepend additional Claude arguments from `CLAUDE_CLI_EXTRA_ARGS`.

Launchd automation entrypoints also source:

- `/Users/jeongjaeyong/Projects/donbeolja/ops/launchd/load_ai_cli_env.sh`

This keeps Codex/Claude CLI paths and fallback-related environment variables aligned across shell sessions and scheduled jobs.

## Environment Variables

- `CLAUDE_CLI_CMD`
  - Default: `$HOME/.local/bin/claude`
  - Override only if Claude CLI path changes.

- `CLAUDE_CLI_EXTRA_ARGS`
  - Optional extra Claude args for fallback sessions.
  - Default:
    ```bash
    --model sonnet --permission-mode acceptEdits
    ```
  - Example:
    ```bash
    export CLAUDE_CLI_EXTRA_ARGS="--model opus --permission-mode acceptEdits"
    ```

- `CODEX_FALLBACK_LOG_PATH`
  - Default: `$HOME/.codex/logs/codex-fallback.log`
  - Every fallback event appends a timestamped line here.

- `FALLBACK_PATTERNS`
  - Optional regex override for the failure patterns that trigger Claude fallback.
  - Default includes:
    - `usage limit`
    - `rate limit`
    - `too many requests`
    - `429`
    - `quota`
    - `insufficient_quota`
    - `token budget`
    - `context window`
    - `maximum context`
    - `billing`
    - `credit balance`
    - `model is overloaded`

- `CODEX_FALLBACK_TEST`
  - Test mode only.
  - `1` simulates a Codex quota failure without actually launching Codex.

## Verification Commands

Reload shell:

```bash
source ~/.zshrc
```

Check binding:

```bash
type codex
type claude
echo "$CLAUDE_CLI_CMD"
```

Test fallback without launching Codex:

```bash
CODEX_FALLBACK_TEST=1 CLAUDE_CLI_CMD=/bin/echo ~/.local/bin/codex-with-fallback hello world
```

Expected output:

```text
[codex-fallback] codex quota/token limit detected; switching to Claude CLI
hello world
```

Test real Claude executable path:

```bash
CODEX_FALLBACK_TEST=1 ~/.local/bin/codex-with-fallback --version
```

Expected output includes Claude version.

Inspect fallback log:

```bash
tail -n 20 ~/.codex/logs/codex-fallback.log
```

## Operational Notes

- This is CLI fallback only. It does not change GUI app behavior.
- The wrapper does not try to translate Codex-specific flags into Claude-specific flags.
- Keep `CLAUDE_CLI_EXTRA_ARGS` limited to Claude-native flags.
- If Codex fails for non-quota reasons, wrapper returns the original Codex exit code and does not fall back.
- Repo automation scripts that already implement their own API fallback should keep using their current internal fallback path. The shell wrapper is primarily for interactive CLI use and shell-based operational entrypoints.

## Node-level openclaw narrative reasoner (in-repo fallback)

The openclaw narrative reasoner at `src/services/openclawNarrativeReasoner.js` ships a **Node-level** equivalent of this fallback. Since 2026-04-20 its default provider mode is `CODEX_CLI_FIRST`: spawn the local `codex` binary directly (NOT via the `codex-with-fallback` shell wrapper, because openclaw owns its own response parsing contract), and on any exhausted/auth/spawn failure fall through to the Claude CLI adapter (`src/services/claudeCliClient.js`). Both providers speak to the already-authenticated local CLIs — no plaintext API keys in launchd environment files.

### Invocation contract

- Codex adapter: `src/services/codexCliClient.js`
  - `codex exec --sandbox read-only --skip-git-repo-check --ephemeral --color never --output-last-message <TMPFILE> --model <MODEL> -`
  - Prompt fed on stdin; final agent message read from `<TMPFILE>`.
  - stderr+stdout scanned with the same `QUOTA|USAGE LIMIT|RATE LIMIT|TOO MANY REQUESTS|BILLING|CREDIT|EXHAUST` regex used by `scripts/lib/codex-openai-fallback.js`, so Node-level fallback fires on the same signals as the shell wrapper.
- Claude adapter: `src/services/claudeCliClient.js` (unchanged; now the fallback provider).

### Environment variables

| Variable | Default | Notes |
|---|---|---|
| `OPENCLAW_NARRATIVE_PROVIDER_MODE` | `CODEX_CLI_FIRST` | Override with `CLI` to disable Codex entirely, `API` for Anthropic HTTP, or `CODEX_FIRST` for the legacy OpenAI-HTTP Codex path. |
| `OPENCLAW_CODEX_CLI_BIN` | `$CODEX_BIN` → `codex` | Path to the raw Codex binary. Falls back to `$CODEX_BIN` (set by `ops/launchd/load_ai_cli_env.sh` → `/Applications/Codex.app/Contents/Resources/codex`) when unset, then to bare `codex` on PATH. Do NOT point this at `codex-with-fallback`; the wrapper mangles output. |
| `OPENCLAW_CODEX_CLI_MODEL` | `gpt-5.2-codex` | Also falls back to `OPENAI_CODEX_FALLBACK_MODEL` if unset. |
| `OPENCLAW_CODEX_CLI_TIMEOUT_MS` | `15000` | Clamped to `[1000, 60000]`. |
| `OPENCLAW_CODEX_CLI_SANDBOX` | `read-only` | Valid: `read-only`, `workspace-write`, `danger-full-access`. Unknown values fall back to `read-only`. |

### Fallback trigger reasons

When Codex CLI fails, the narrative reasoner surfaces one of these reasons in `failures[]` and then attempts Claude CLI:

- `CODEX_CLI_USAGE_EXHAUSTED` — quota/rate-limit/billing pattern matched.
- `CODEX_CLI_AUTH_BLOCKED` — auth/login/unauthorized/forbidden pattern matched.
- `CODEX_CLI_CLIENT_UNAVAILABLE` — `codex` binary not on PATH / module load failed.
- `TIMEOUT`, `SPAWN_FAIL`, `NONZERO_EXIT`, `NON_JSON_OUTPUT`, `EMPTY_OUTPUT` — generic failures.

### Test coverage

- `src/tests/codex-cli-client.test.js` — args builder, quota/auth classifier, timeout clamps, empty-prompt refusal, bogus-binary failure mode.
- `src/tests/openclaw-decision-agent.test.js` — pins the `CODEX_CLI → CLI` sequence and the happy-path-after-exhaustion flow (Codex returns `CODEX_CLI_USAGE_EXHAUSTED`, Claude CLI returns a parsed response, `response.reason` forwarded verbatim).
- `src/tests/claude-cli-client.test.js` — updated to assert the reasoner's new default is `CODEX_CLI_FIRST` (not `CLI`).

### Operational rollout

openclaw runs only under local launchd (6 entries), not Cloud Run, so `codex` and `claude` binaries are always available in the process environment. Flipping the default provider mode takes effect on the next launchd tick with no config or deploy change.
