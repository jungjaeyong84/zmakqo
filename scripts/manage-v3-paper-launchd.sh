#!/bin/zsh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.jeongjaeyong.donbeolja.v3paper"
PLIST_SRC="$REPO_ROOT/ops/launchd/v3/$LABEL.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"
RUNNER="$REPO_ROOT/ops/launchd/v3/run_v3_paper_cycle.sh"
GUI_DOMAIN="gui/$(id -u)"

usage() {
  cat <<'EOF'
usage: zsh scripts/manage-v3-paper-launchd.sh <install|uninstall|start|stop|restart|status|run-once>
EOF
}

ensure_files() {
  [[ -f "$PLIST_SRC" ]] || { echo "missing plist: $PLIST_SRC" >&2; exit 1; }
  [[ -x "$RUNNER" ]] || chmod +x "$RUNNER"
}

bootout_if_loaded() {
  launchctl bootout "$GUI_DOMAIN/$LABEL" >/dev/null 2>&1 \
    || launchctl bootout "$GUI_DOMAIN" "$PLIST_DST" >/dev/null 2>&1 \
    || true
}

install_job() {
  ensure_files
  mkdir -p "$HOME/Library/LaunchAgents"
  cp "$PLIST_SRC" "$PLIST_DST"
  plutil -lint "$PLIST_DST" >/dev/null
  bootout_if_loaded
  launchctl bootstrap "$GUI_DOMAIN" "$PLIST_DST"
  launchctl enable "$GUI_DOMAIN/$LABEL" >/dev/null 2>&1 || true
  launchctl kickstart -k "$GUI_DOMAIN/$LABEL"
  echo "installed $LABEL"
}

uninstall_job() {
  bootout_if_loaded
  rm -f "$PLIST_DST"
  echo "uninstalled $LABEL"
}

start_job() {
  ensure_files
  if [[ ! -f "$PLIST_DST" ]]; then
    install_job
    return 0
  fi
  launchctl kickstart -k "$GUI_DOMAIN/$LABEL"
  echo "started $LABEL"
}

stop_job() {
  bootout_if_loaded
  echo "stopped $LABEL"
}

status_job() {
  if [[ -f "$PLIST_DST" ]]; then
    echo "plist=$PLIST_DST"
  else
    echo "plist=MISSING"
  fi
  launchctl print "$GUI_DOMAIN/$LABEL"
}

run_once() {
  ensure_files
  "$RUNNER"
}

ACTION="${1:-status}"

case "$ACTION" in
  install) install_job ;;
  uninstall) uninstall_job ;;
  start) start_job ;;
  stop) stop_job ;;
  restart) stop_job; install_job ;;
  status) status_job ;;
  run-once) run_once ;;
  *)
    usage
    exit 1
    ;;
esac
