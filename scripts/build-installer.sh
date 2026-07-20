#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_ARCH="${TARGET_ARCH:-arm64}"

case "$TARGET_ARCH" in
  arm64) ARCH_FLAG="--arm64" ;;
  x64) ARCH_FLAG="--x64" ;;
  universal) ARCH_FLAG="--universal" ;;
  *)
    echo "Unsupported TARGET_ARCH: $TARGET_ARCH (allowed: arm64, x64, universal)"
    exit 1
    ;;
esac

echo "==> Build production dist"
cd "$ROOT_DIR"
npm run build

echo "==> Build macOS installer (.dmg), arch=$TARGET_ARCH"
npx electron-builder --mac dmg "$ARCH_FLAG" --publish never

echo "==> Installer artifacts"
ls -lh "$ROOT_DIR/release"/*.dmg
