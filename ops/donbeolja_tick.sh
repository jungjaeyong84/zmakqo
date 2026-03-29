#!/bin/zsh
set -e
set -a
source /Users/jeongjaeyong/Projects/donbeolja/ops/.env.runtime.local
set +a

curl -sS -X POST http://127.0.0.1:${PORT}/scheduler/tick >/tmp/donbeolja_tick_last.json 2>/tmp/donbeolja_tick_last.err
curl -sS "http://127.0.0.1:${PORT}/report/latest?n=10" >/tmp/donbeolja_report_latest.json 2>/tmp/donbeolja_report_latest.err
