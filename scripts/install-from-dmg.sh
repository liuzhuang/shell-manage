#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_DIR="$ROOT_DIR/release"
INSTALL_DEST="/Applications/ShellManage.app"
KEEP_RELEASE="${KEEP_RELEASE:-0}"
SKIP_LAUNCH="${SKIP_LAUNCH:-0}"
DMG_PATH="${DMG_PATH:-}"
MOUNT_POINT=""

cleanup_mount() {
  if [[ -n "${MOUNT_POINT:-}" && -d "$MOUNT_POINT" ]]; then
    hdiutil detach "$MOUNT_POINT" -quiet || true
    MOUNT_POINT=""
  fi
}

quit_shell_manage() {
  echo "==> Quit ShellManage if running"
  osascript -e 'tell application "ShellManage" to quit' 2>/dev/null || true

  local attempt
  for attempt in {1..20}; do
    if ! pgrep -f "ShellManage.app" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done

  echo "[install:mac] ShellManage is still running; close it manually and retry"
  exit 1
}

resolve_dmg() {
  if [[ -n "$DMG_PATH" ]]; then
    if [[ ! -f "$DMG_PATH" ]]; then
      echo "[install:mac] DMG not found: $DMG_PATH"
      exit 1
    fi
    printf '%s\n' "$DMG_PATH"
    return 0
  fi

  if [[ ! -d "$RELEASE_DIR" ]]; then
    echo "release 目录不存在，请先运行: npm run build:installer:mac"
    exit 1
  fi

  shopt -s nullglob
  local dmg_candidates=("$RELEASE_DIR"/*.dmg)
  shopt -u nullglob

  if [[ "${#dmg_candidates[@]}" -eq 0 ]]; then
    echo "未找到 .dmg 产物，请先运行: npm run build:installer:mac"
    exit 1
  fi

  local latest_dmg
  latest_dmg="$(ls -t "${dmg_candidates[@]}" | awk 'NR==1 { print; exit }')"

  if [[ -z "$latest_dmg" || ! -f "$latest_dmg" ]]; then
    echo "未找到 .dmg 产物，请先运行: npm run build:installer:mac"
    exit 1
  fi

  printf '%s\n' "$latest_dmg"
}

install_from_dmg() {
  local dmg="$1"
  local app_path=""

  echo "==> Install from dmg"
  echo "DMG: $dmg"

  quit_shell_manage

  echo "==> Attach dmg"
  local attach_output
  attach_output="$(hdiutil attach "$dmg" -nobrowse -readonly)"
  MOUNT_POINT="$(printf '%s\n' "$attach_output" | awk -F '\t' '/\/Volumes\// { print $3; exit }')"

  if [[ -z "$MOUNT_POINT" || ! -d "$MOUNT_POINT" ]]; then
    echo "无法获取挂载目录"
    exit 1
  fi

  trap cleanup_mount EXIT

  shopt -s nullglob
  local app_candidates=("$MOUNT_POINT"/*.app)
  shopt -u nullglob
  app_path="${app_candidates[0]-}"

  if [[ -z "$app_path" || ! -d "$app_path" ]]; then
    echo "挂载内容中未找到 .app"
    exit 1
  fi

  echo "==> Copy app to $INSTALL_DEST"
  ditto "$app_path" "$INSTALL_DEST"

  cleanup_mount
  trap - EXIT
}

cleanup_release_dir() {
  if [[ "$KEEP_RELEASE" == "1" ]]; then
    echo "==> Keep release directory (KEEP_RELEASE=1)"
    return 0
  fi

  if [[ ! -d "$RELEASE_DIR" ]]; then
    return 0
  fi

  echo "==> Remove release directory"
  rm -rf "$RELEASE_DIR"
}

launch_shell_manage() {
  if [[ "$SKIP_LAUNCH" == "1" ]]; then
    echo "==> Skip launch (SKIP_LAUNCH=1)"
    return 0
  fi

  echo "==> Launch ShellManage"
  open -a "$INSTALL_DEST"
}

LATEST_DMG="$(resolve_dmg)"
install_from_dmg "$LATEST_DMG"
cleanup_release_dir
launch_shell_manage

echo "==> Install complete"
echo "Installed: $INSTALL_DEST"
