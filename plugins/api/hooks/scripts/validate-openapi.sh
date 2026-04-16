#!/bin/bash
# validate-openapi.sh
# PostToolUse hook: validates OpenAPI JSON files written to /tmp/
#
# Exits 0  — file is not a /tmp/*.json target, or validation passed
# Exits 1  — validation failed (blocking; Claude must fix and rewrite)

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only validate openapi-prefixed JSON files written to /tmp/
if [[ -z "$FILE_PATH" ]] || [[ "$FILE_PATH" != /tmp/openapi-*.json ]]; then
  exit 0
fi

# File should exist after Write; be defensive
if [[ ! -f "$FILE_PATH" ]]; then
  exit 0
fi

ERRORS=()

# 1. Must be parseable JSON
if ! jq empty "$FILE_PATH" 2>/dev/null; then
  echo "OpenAPI validation FAILED: $FILE_PATH is not valid JSON."
  echo "Fix the JSON syntax and rewrite the file."
  exit 1
fi

# 2. openapi field: must exist and be 3.0.x or 3.1.x (both supported by sdkck)
OPENAPI_VER=$(jq -r '.openapi // empty' "$FILE_PATH")
if [[ -z "$OPENAPI_VER" ]]; then
  ERRORS+=('Missing required field: "openapi"')
elif ! echo "$OPENAPI_VER" | grep -qE '^3\.(0|1)\.'; then
  ERRORS+=("\"openapi\" must be \"3.0.x\" or \"3.1.x\", got: \"$OPENAPI_VER\"")
fi

# 3. info.title must be a non-empty string
INFO_TITLE=$(jq -r '.info.title // empty' "$FILE_PATH")
[[ -z "$INFO_TITLE" ]] && ERRORS+=('Missing required field: "info.title"')

# 4. info.version must be a non-empty string
INFO_VER=$(jq -r '.info.version // empty' "$FILE_PATH")
[[ -z "$INFO_VER" ]] && ERRORS+=('Missing required field: "info.version"')

# 5. paths must be a non-empty object
PATHS_TYPE=$(jq -r '(.paths // null) | type' "$FILE_PATH")
if [[ "$PATHS_TYPE" != "object" ]]; then
  ERRORS+=('Missing required field: "paths" (must be an object)')
else
  PATHS_COUNT=$(jq '.paths | length' "$FILE_PATH")
  if [[ "$PATHS_COUNT" -eq 0 ]]; then
    ERRORS+=("\"paths\" is empty — no API endpoints were extracted")
  fi
fi

# 6. Every HTTP operation must have a non-empty responses object
if [[ "$PATHS_TYPE" == "object" ]]; then
  MISSING_RESPONSES=$(jq -r '
    .paths | to_entries[] |
    .key as $path |
    .value | to_entries[] |
    select(.key | test("^(get|put|post|delete|options|head|patch|trace)$")) |
    select((.value.responses == null) or (.value.responses | length == 0)) |
    "Operation \(.key | ascii_upcase) \($path) is missing \"responses\""
  ' "$FILE_PATH" 2>/dev/null || true)

  if [[ -n "$MISSING_RESPONSES" ]]; then
    while IFS= read -r line; do
      ERRORS+=("$line")
    done <<< "$MISSING_RESPONSES"
  fi
fi

# 7. operationId values must be unique across the document
if [[ "$PATHS_TYPE" == "object" ]]; then
  DUPLICATE_IDS=$(jq -r '
    [.paths | .. | objects | .operationId? // empty] |
    group_by(.) | map(select(length > 1)) | .[] | .[0] |
    "Duplicate operationId: \"" + . + "\""
  ' "$FILE_PATH" 2>/dev/null || true)

  if [[ -n "$DUPLICATE_IDS" ]]; then
    while IFS= read -r line; do
      ERRORS+=("$line")
    done <<< "$DUPLICATE_IDS"
  fi
fi

# Report
if [[ ${#ERRORS[@]} -gt 0 ]]; then
  echo "OpenAPI validation FAILED: $FILE_PATH"
  for err in "${ERRORS[@]}"; do
    echo "  - $err"
  done
  echo ""
  echo "Fix the above issues and rewrite $FILE_PATH to pass validation."
  exit 1
fi

echo "OpenAPI validation PASSED ($OPENAPI_VER): $FILE_PATH"
exit 0
