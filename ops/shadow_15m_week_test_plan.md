# 15m Shadow Week Test Plan

Date: 2026-03-14

## Goal

- Keep `60m` live operation unchanged.
- Prepare `15m` as a weekly test candidate.
- Preserve time-stop duration equivalence:
  - `60m 18B` -> `15m 72B`

## What was implemented

1. `15m` is now accepted as a supported signal TF in runtime normalization.
2. Binance futures time-stop bar count now scales by signal TF.
   - Example: configured `max_hold_bars=18`
   - `60m` signal -> `18B`
   - `15m` signal -> `72B`
3. Paper collections can now be isolated by namespace via `PAPER_NAMESPACE`.
   - Example:
   - `positions_paper__shadow15m`
   - `order_intents_paper__shadow15m`
   - `fills_paper__shadow15m`
   - `trades_paper__shadow15m`

## Why full parallel shadow was NOT enabled yet

Current paper/runtime storage is symbol-scoped, not TF-scoped:

- `positions_paper`: `POS__<exchange>__<symbol>`
- `order_intents_paper`: scope includes TF, but positions do not
- `fills_paper`: shared collection

This means:

- `BINANCEFUT BTCUSDT 60m live`
- `BINANCEFUT BTCUSDT 15m shadow`

would share the same position document and can contaminate each other.

## Safe next step

Choose one of the following before enabling real 15m shadow:

1. Run a separate shadow process with:
   - `PAPER_NAMESPACE=shadow15m`
   - `EXCHANGE_TF_ALLOWLIST=15m`
   - `EXCHANGE_EXEC_TF=15m`
   - `execution_mode=PAPER` or `LIVE_DRY_RUN`
2. Run `15m` as offline replay/report only.
3. Switch the whole BINANCEFUT runtime to `15m` temporarily, but only if live 60m is intentionally stopped first.

## Current recommendation

- Do not enable parallel `15m shadow` in the production scheduler yet.
- Use the new `15m` TF support and time-stop scaling as preparation only.
