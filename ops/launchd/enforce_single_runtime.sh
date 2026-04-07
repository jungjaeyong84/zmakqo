#!/bin/zsh
set -euo pipefail

LABEL="${DONBEOLJA_LAUNCHD_LABEL:-com.jeongjaeyong.donbeolja.server}"
PLIST_PATH="${DONBEOLJA_LAUNCHD_PLIST:-$HOME/Library/LaunchAgents/${LABEL}.plist}"
PORT="${DONBEOLJA_PORT:-3000}"

uid="$(id -u)"

if [[ ! -f "$PLIST_PATH" ]]; then
  echo "[ERR] launchd plist not found: $PLIST_PATH"
  exit 1
fi

echo "[STEP] ensure launchd service loaded: $LABEL"
if ! launchctl print "gui/${uid}/${LABEL}" >/dev/null 2>&1; then
  launchctl bootstrap "gui/${uid}" "$PLIST_PATH"
fi
launchctl enable "gui/${uid}/${LABEL}" >/dev/null 2>&1 || true
launchctl kickstart -k "gui/${uid}/${LABEL}"

sleep 1

launch_pid="$(launchctl print "gui/${uid}/${LABEL}" 2>/dev/null | awk '/pid = /{print $3; exit}')"
if [[ -z "${launch_pid:-}" || "$launch_pid" == "0" ]]; then
  echo "[ERR] launchd service has no running pid"
  exit 1
fi

echo "[STEP] remove stray node server.js processes (except launchd pid=$launch_pid)"
all_node_pids="$(pgrep -f 'node server.js' || true)"
if [[ -n "${all_node_pids:-}" ]]; then
  for p in ${(f)all_node_pids}; do
    [[ -z "$p" ]] && continue
    if [[ "$p" != "$launch_pid" ]]; then
      kill "$p" >/dev/null 2>&1 || true
    fi
  done
fi

echo "[STEP] remove PM2 app/runtime for donbeolja"
if command -v pm2 >/dev/null 2>&1; then
  pm2 delete donbeolja >/dev/null 2>&1 || true
  pm2 kill >/dev/null 2>&1 || true
fi

sleep 1

echo "[CHECK] launchd pid"
launchctl print "gui/${uid}/${LABEL}" | sed -n '1,60p' | rg -n 'state =|pid =|path =|program =|arguments =|stdout path =|stderr path ='

echo "[CHECK] listener"
lsof -nP -iTCP:"$PORT" -sTCP:LISTEN

echo "[CHECK] health"
curl -fsS "http://127.0.0.1:${PORT}/health"
echo

echo "[CHECK] remaining node server.js pids"
pgrep -af 'node server.js' || true

echo "[DONE] launchctl single runtime enforced"
