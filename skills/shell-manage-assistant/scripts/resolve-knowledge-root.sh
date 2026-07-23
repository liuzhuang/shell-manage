#!/usr/bin/env bash
# resolve-knowledge-root.sh — locate bundled knowledge root and optionally verify integrity
set -euo pipefail

MARKER="install-and-upgrade.md"
OUTPUT_JSON=0
VERIFY=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

REQUIRED_FILES=(
  "install-and-upgrade.md"
  "config-schema.md"
  "config-workflow.md"
  "command-recipes.md"
  "troubleshooting.md"
  "runtime-protocols.md"
)

usage() {
  cat <<'EOF'
Usage: resolve-knowledge-root.sh [OPTIONS]

Resolve the shell-manage skill knowledge root (bundled references/).

Options:
  --help     Show this help and exit
  --json     Emit JSON: {"path":"...","source":"...","missing":[...]}
  --verify   Also verify required knowledge files exist (non-zero exit if any missing)

Resolution order:
  1. <skill-root>/references/ (bundled with installed skill)

Exit codes:
  0  Knowledge root found (and complete, when --verify is set)
  1  Not found, or required files missing under --verify
  2  Invalid usage
EOF
}

is_valid_root() {
  local dir="$1"
  [[ -d "$dir" && -f "$dir/$MARKER" ]]
}

# Collect missing required files into the global MISSING array.
MISSING=()
collect_missing() {
  local dir="$1"
  MISSING=()
  local f
  for f in "${REQUIRED_FILES[@]}"; do
    [[ -f "$dir/$f" ]] || MISSING+=("$f")
  done
}

emit() {
  local path="$1"
  local source="$2"
  if [[ "$OUTPUT_JSON" -eq 1 ]]; then
    local json_missing="" sep=""
    local m
    for m in "${MISSING[@]:-}"; do
      [[ -z "$m" ]] && continue
      json_missing+="${sep}\"${m}\""
      sep=","
    done
    printf '{"path":"%s","source":"%s","missing":[%s]}\n' "$path" "$source" "$json_missing"
  else
    printf '%s\n' "$path"
    if [[ "$VERIFY" -eq 1 && "${#MISSING[@]}" -gt 0 ]]; then
      local m
      for m in "${MISSING[@]}"; do
        echo "missing: $m" >&2
      done
    fi
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --json)
      OUTPUT_JSON=1
      shift
      ;;
    --verify)
      VERIFY=1
      shift
      ;;
    *)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

candidate="$SKILL_ROOT/references"
if is_valid_root "$candidate"; then
  if [[ "$VERIFY" -eq 1 ]]; then
    collect_missing "$candidate"
  fi
  emit "$candidate" "skill-local"
  if [[ "$VERIFY" -eq 1 && "${#MISSING[@]}" -gt 0 ]]; then
    exit 1
  fi
  exit 0
fi

if [[ "$OUTPUT_JSON" -eq 1 ]]; then
  printf '{"path":null,"source":"not-found","missing":[]}\n'
fi
exit 1
