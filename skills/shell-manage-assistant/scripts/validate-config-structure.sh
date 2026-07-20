#!/usr/bin/env bash
# validate-config-structure.sh — check ShellManage YAML config top-level structure
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: validate-config-structure.sh [OPTIONS] CONFIG.yaml

Validate ShellManage config structure (commands, presets, settings).
Options may appear before or after CONFIG.yaml.

Options:
  --help    Show this help and exit
  --json    Emit JSON result

Exit codes:
  0  Valid
  1  Invalid structure or unreadable file
  2  Invalid usage
EOF
}

OUTPUT_JSON=0
CONFIG=""

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
    --)
      shift
      while [[ $# -gt 0 ]]; do
        if [[ -z "$CONFIG" ]]; then
          CONFIG="$1"
        else
          echo "error: unexpected extra argument: $1" >&2
          usage >&2
          exit 2
        fi
        shift
      done
      break
      ;;
    -*)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [[ -z "$CONFIG" ]]; then
        CONFIG="$1"
      else
        echo "error: unexpected extra argument: $1" >&2
        usage >&2
        exit 2
      fi
      shift
      ;;
  esac
done

if [[ -z "$CONFIG" ]]; then
  echo "error: CONFIG.yaml path required" >&2
  usage >&2
  exit 2
fi

if [[ ! -f "$CONFIG" ]]; then
  if [[ "$OUTPUT_JSON" -eq 1 ]]; then
    printf '{"valid":false,"errors":["file not found"]}\n'
  else
    echo "error: file not found: $CONFIG" >&2
  fi
  exit 1
fi

if ! command -v ruby >/dev/null 2>&1; then
  if [[ "$OUTPUT_JSON" -eq 1 ]]; then
    printf '{"valid":false,"errors":["ruby not found; required for structure validation (preinstalled on macOS)"]}\n'
  else
    echo "error: ruby not found; required for structure validation (preinstalled on macOS)" >&2
  fi
  exit 1
fi

result="$(ruby -r yaml -r json - "$CONFIG" <<'RUBY'
path = ARGV[0]
errors = []
begin
  data = YAML.load_file(path)
rescue StandardError => e
  puts JSON.generate(valid: false, errors: ["yaml parse error: #{e.message}"])
  exit
end

if data.nil? || !data.is_a?(Hash)
  errors << "root must be a mapping"
else
  %w[commands presets settings].each do |key|
    errors << "missing top-level key: #{key}" unless data.key?(key)
  end
  errors << "commands must be an array" if data["commands"] && !data["commands"].is_a?(Array)
  errors << "presets must be an array" if data["presets"] && !data["presets"].is_a?(Array)
  errors << "settings must be a mapping" if data["settings"] && !data["settings"].is_a?(Hash)
end

puts JSON.generate(valid: errors.empty?, errors: errors)
RUBY
)"

valid="$(printf '%s' "$result" | ruby -r json -e 'puts JSON.parse(STDIN.read)["valid"]')"

if [[ "$OUTPUT_JSON" -eq 1 ]]; then
  printf '%s\n' "$result"
else
  if [[ "$valid" == "true" ]]; then
    echo "valid: $CONFIG"
  else
    printf '%s' "$result" | ruby -r json -e 'JSON.parse(STDIN.read)["errors"].each { |e| warn "error: #{e}" }'
  fi
fi

[[ "$valid" == "true" ]]
