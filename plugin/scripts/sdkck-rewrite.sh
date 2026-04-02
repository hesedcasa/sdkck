#!/usr/bin/env bash
# sdkck Claude Code hook — surfaces relevant sdkck commands for MCP tool calls.

if ! command -v jq &>/dev/null; then
  echo "WARNING: jq is not installed. Install jq: https://jqlang.github.io/jq/download/" >&2
  exit 0
fi

if ! command -v sdkck &>/dev/null; then
  echo "WARNING: sdkck is not installed. Install: npm install -g sdkck" >&2
  exit 0
fi

# Exit immediately if stdin is a terminal (no piped input — would block forever).
if [ -t 0 ]; then
  exit 0
fi

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# ── sdkck command discovery ────────────────────────────────────────────────────
# Extract keywords from the MCP tool name, e.g.:
#   mcp__claude_ai_Atlassian__getJiraIssue → atlassian, jira, issue
KEYWORDS=$(printf '%s' "$TOOL_NAME" \
  | sed 's/^mcp__//' \
  | tr '_' '\n' \
  | grep -oE '[a-zA-Z][a-zA-Z0-9-]{2,}' \
  | sed 's/\([a-z]\)\([A-Z]\)/\1\n\2/g' \
  | tr '[:upper:]' '[:lower:]' \
  | grep -vE '^(mcp|claude|get|the|and|for|with|from|this|that|plugin)$' \
  | sort -u)

if [ -n "$KEYWORDS" ]; then
  SDKCK_CMDS=$(sdkck search "$(printf '%s ' $KEYWORDS)" 2>/dev/null | head -20)
  if [ -n "$SDKCK_CMDS" ]; then
    jq -n --arg context "$SDKCK_CMDS" '{
      "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": "Use sdkck cli with one of these commands instead: '"$SDKCK_CMDS"'"
      }
    }'
  fi
fi
