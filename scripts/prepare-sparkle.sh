#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-client}"
SPARKLE_VERSION="2.9.4"
SOURCE_SHA256="f22982ba6e1a951be4b60bdd0733e74e99b28eed6c3013edd99765af87c79d49"
TOOLS_SHA256="ce89daf967db1e1893ed3ebd67575ed82d3902563e3191ca92aaec9164fbdef9"
SOURCE_URL="https://github.com/sparkle-project/Sparkle/archive/refs/tags/${SPARKLE_VERSION}.tar.gz"
TOOLS_URL="https://github.com/sparkle-project/Sparkle/releases/download/${SPARKLE_VERSION}/Sparkle-${SPARKLE_VERSION}.tar.xz"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Sparkle can only be prepared on macOS" >&2
  exit 1
fi

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/shell-manage-sparkle.XXXXXX")"
cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

download_and_verify() {
  local url="$1"
  local sha256="$2"
  local output="$3"
  curl --fail --location --retry 3 --output "$output" "$url"
  printf '%s  %s\n' "$sha256" "$output" | shasum -a 256 --check
}

prepare_client() {
  local archive="$TEMP_DIR/Sparkle-source.tar.gz"
  local source_dir="$TEMP_DIR/Sparkle-${SPARKLE_VERSION}"
  local derived_data="$TEMP_DIR/DerivedData"
  local output_dir="$ROOT_DIR/build/sparkle"
  local output_app="$output_dir/sparkle.app"

  download_and_verify "$SOURCE_URL" "$SOURCE_SHA256" "$archive"
  tar -xzf "$archive" -C "$TEMP_DIR"

  local cli_config="$source_dir/Configurations/ConfigSparkleTool.xcconfig"
  sed -i '' \
    's/^PRODUCT_BUNDLE_IDENTIFIER = org\.sparkle-project\.sparkle-cli$/PRODUCT_BUNDLE_IDENTIFIER = com.liuzhuang.shell-manage.sparkle-cli/' \
    "$cli_config"
  grep -Fxq 'PRODUCT_BUNDLE_IDENTIFIER = com.liuzhuang.shell-manage.sparkle-cli' "$cli_config"

  if ! xcodebuild \
    -project "$source_dir/Sparkle.xcodeproj" \
    -scheme sparkle-cli \
    -configuration Release \
    -destination 'generic/platform=macOS' \
    -derivedDataPath "$derived_data" \
    CODE_SIGNING_ALLOWED=NO \
    CODE_SIGNING_REQUIRED=NO \
    'ARCHS=arm64 x86_64' \
    ONLY_ACTIVE_ARCH=NO \
    build >"$TEMP_DIR/xcodebuild.log"; then
    tail -200 "$TEMP_DIR/xcodebuild.log" >&2
    exit 1
  fi

  rm -rf "$output_dir"
  mkdir -p "$output_dir"
  ditto "$derived_data/Build/Products/Release/sparkle.app" "$output_app"
  mkdir -p "$output_app/Contents/Resources"
  cp "$source_dir/LICENSE" "$output_app/Contents/Resources/Sparkle-LICENSE.txt"

  local executable="$output_app/Contents/MacOS/sparkle"
  local architectures
  architectures="$(lipo -archs "$executable")"
  [[ "$architectures" == *arm64* && "$architectures" == *x86_64* ]] || {
    echo "Sparkle CLI is not universal: $architectures" >&2
    exit 1
  }

  local bundle_id
  bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$output_app/Contents/Info.plist")"
  [[ "$bundle_id" == "com.liuzhuang.shell-manage.sparkle-cli" ]] || {
    echo "Unexpected Sparkle CLI bundle id: $bundle_id" >&2
    exit 1
  }

  echo "Prepared Sparkle updater: $output_app ($architectures)"
}

prepare_tools() {
  local archive="$TEMP_DIR/Sparkle-tools.tar.xz"
  local extracted="$TEMP_DIR/tools"
  local output_dir="$ROOT_DIR/build/sparkle-tools"

  download_and_verify "$TOOLS_URL" "$TOOLS_SHA256" "$archive"
  mkdir -p "$extracted"
  tar -xJf "$archive" -C "$extracted"

  rm -rf "$output_dir"
  mkdir -p "$output_dir"
  cp -R "$extracted/bin" "$output_dir/bin"
  cp "$extracted/LICENSE" "$output_dir/Sparkle-LICENSE.txt"
  "$output_dir/bin/generate_appcast" --help >/dev/null

  echo "Prepared Sparkle release tools: $output_dir/bin"
}

case "$MODE" in
  client) prepare_client ;;
  tools) prepare_tools ;;
  *)
    echo "Usage: $0 [client|tools]" >&2
    exit 1
    ;;
esac
