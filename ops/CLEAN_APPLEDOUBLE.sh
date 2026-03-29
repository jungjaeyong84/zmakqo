#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:-.}"
find "$ROOT" \( -name '._*' -o -name '.DS_Store' \) -print -delete
