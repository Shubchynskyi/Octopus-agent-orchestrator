#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v pwsh >/dev/null 2>&1; then
  echo "pwsh is required to run check-update.ps1. Install PowerShell 7+ and retry." >&2
  exit 1
fi

exec pwsh -File "$SCRIPT_DIR/check-update.ps1" "$@"
