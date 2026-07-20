#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_DIR="$ROOT_DIR/release"

if [[ ! -d "$RELEASE_DIR" ]]; then
  echo "release 目录不存在，请先运行: npm run build:installer:mac"
  exit 1
fi

shopt -s nullglob
DMG_CANDIDATES=("$RELEASE_DIR"/*.dmg)
shopt -u nullglob

if [[ "${#DMG_CANDIDATES[@]}" -eq 0 ]]; then
  echo "未找到 .dmg 产物，请先运行: npm run build:installer:mac"
  exit 1
fi

LATEST_DMG="$(ls -t "${DMG_CANDIDATES[@]}" | awk 'NR==1 { print; exit }')"

if [[ -z "$LATEST_DMG" || ! -f "$LATEST_DMG" ]]; then
  echo "未找到 .dmg 产物，请先运行: npm run build:installer:mac"
  exit 1
fi

echo "==> Verify dmg structure"
echo "DMG: $LATEST_DMG"
hdiutil verify "$LATEST_DMG"

echo "==> Attach dmg and check app bundle"
ATTACH_OUTPUT="$(hdiutil attach "$LATEST_DMG" -nobrowse -readonly)"
MOUNT_POINT="$(printf '%s\n' "$ATTACH_OUTPUT" | awk -F '\t' '/\/Volumes\// { print $3; exit }')"

if [[ -z "$MOUNT_POINT" || ! -d "$MOUNT_POINT" ]]; then
  echo "无法获取挂载目录"
  exit 1
fi

cleanup() {
  if [[ -n "${MOUNT_POINT:-}" && -d "$MOUNT_POINT" ]]; then
    hdiutil detach "$MOUNT_POINT" -quiet || true
  fi
}
trap cleanup EXIT

shopt -s nullglob
APP_CANDIDATES=("$MOUNT_POINT"/*.app)
shopt -u nullglob
APP_PATH="${APP_CANDIDATES[0]-}"

if [[ -z "$APP_PATH" ]]; then
  echo "挂载内容中未找到 .app"
  exit 1
fi

if [[ ! -L "$MOUNT_POINT/Applications" ]]; then
  echo "挂载内容中未找到 Applications 快捷链接"
  exit 1
fi

if [[ ! -f "$MOUNT_POINT/dmg-install-guide.txt" ]]; then
  echo "挂载内容中未找到安装说明文件 dmg-install-guide.txt"
  exit 1
fi

if [[ ! -f "$APP_PATH/Contents/Resources/icons/trayTemplate.png" ]]; then
  echo "应用资源中未找到托盘图标: Contents/Resources/icons/trayTemplate.png"
  exit 1
fi

INFO_PLIST="$APP_PATH/Contents/Info.plist"
if [[ ! -f "$INFO_PLIST" ]]; then
  echo "未找到 Info.plist: $INFO_PLIST"
  exit 1
fi

BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$INFO_PLIST" 2>/dev/null || true)"
APP_NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleName' "$INFO_PLIST" 2>/dev/null || true)"
EXECUTABLE_NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$INFO_PLIST" 2>/dev/null || true)"

if [[ -z "$BUNDLE_ID" || -z "$EXECUTABLE_NAME" ]]; then
  echo "Info.plist 缺少关键字段（CFBundleIdentifier / CFBundleExecutable）"
  exit 1
fi

if [[ ! -f "$APP_PATH/Contents/MacOS/$EXECUTABLE_NAME" ]]; then
  echo "可执行文件不存在: $APP_PATH/Contents/MacOS/$EXECUTABLE_NAME"
  exit 1
fi

if ! codesign --verify --deep --strict "$APP_PATH"; then
  echo "应用包的 ad-hoc 签名校验失败: $APP_PATH"
  exit 1
fi

echo "==> Verify passed"
echo "App: $APP_PATH"
echo "Applications link: $MOUNT_POINT/Applications"
echo "Install guide: $MOUNT_POINT/dmg-install-guide.txt"
echo "Tray icon: $APP_PATH/Contents/Resources/icons/trayTemplate.png"
echo "CFBundleName: ${APP_NAME:-N/A}"
echo "CFBundleIdentifier: $BUNDLE_ID"
echo "CFBundleExecutable: $EXECUTABLE_NAME"
echo "Code signing: ad-hoc signature verified"
