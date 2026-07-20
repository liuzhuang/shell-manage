#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Build macOS installer"
bash "$ROOT_DIR/scripts/build-installer.sh"

echo "==> Install from dmg and cleanup"
bash "$ROOT_DIR/scripts/install-from-dmg.sh"
