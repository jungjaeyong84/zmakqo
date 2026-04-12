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
