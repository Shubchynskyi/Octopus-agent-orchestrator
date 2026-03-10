#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "Provide git commit arguments, for example: -m \"feat: message\"" >&2
  exit 1
fi

export OCTOPUS_ALLOW_COMMIT=1
exec git commit "$@"
