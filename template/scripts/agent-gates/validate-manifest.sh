#!/usr/bin/env bash
set -euo pipefail

MANIFEST_PATH="${1:-Octopus-agent-orchestrator/MANIFEST.md}"

PYTHON_CMD=()
if command -v python3 >/dev/null 2>&1 && python3 -c "import sys" >/dev/null 2>&1; then
  PYTHON_CMD=(python3)
elif command -v python >/dev/null 2>&1 && python -c "import sys" >/dev/null 2>&1; then
  PYTHON_CMD=(python)
elif command -v py >/dev/null 2>&1 && py -3 -c "import sys" >/dev/null 2>&1; then
  PYTHON_CMD=(py -3)
else
  echo "Python runtime not found. Install python3 (or python/py launcher)." >&2
  exit 1
fi

"${PYTHON_CMD[@]}" - "$MANIFEST_PATH" <<'PY'
import re
import sys
from pathlib import Path


manifest_path = Path(sys.argv[1])
if not manifest_path.exists():
    print(f"Manifest not found: {manifest_path}", file=sys.stderr)
    sys.exit(1)

lines = manifest_path.read_text(encoding="utf-8").splitlines()
items = []
for line in lines:
    match = re.match(r"^\s*-\s+(.+?)\s*$", line)
    if match:
        value = match.group(1).strip()
        if value:
            items.append(value)

if not items:
    print(f"No manifest list items found in: {manifest_path}", file=sys.stderr)
    sys.exit(1)

seen = {}
duplicates = []
for item in items:
    key = item.lower().replace("\\", "/")
    if key in seen:
        duplicates.append(item)
        continue
    seen[key] = item

if duplicates:
    print("MANIFEST_VALIDATION_FAILED")
    print(f"ManifestPath: {manifest_path}")
    print("Duplicate entries:")
    for item in duplicates:
        print(f"- {item}")
    sys.exit(1)

print("MANIFEST_VALIDATION_PASSED")
print(f"ManifestPath: {manifest_path}")
print(f"EntriesChecked: {len(items)}")
PY
