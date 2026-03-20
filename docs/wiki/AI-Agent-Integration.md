# AI Agent Integration

Sidekick is designed from the ground up to be the best companion tool for AI coding agents. This guide covers best practices for integrating Sidekick with Claude Code, Cursor, Windsurf, and other AI development tools.

## Why CLI Over MCP for Agent Tooling?

MCP (Model Context Protocol) servers load entire tool schemas into your agent's context window — often consuming **40-50% of available tokens** before the agent does any real work. Sidekick takes a fundamentally different approach:

1. **LLMs are CLI-native** — Large language models have deep fluency with command-line tools baked into their training. They know how to parse stderr, adjust flags, and compose commands. That fluency doesn't exist for MCP tool chains.

2. **Unix composability is battle-tested** — CLI composability carries the reliability of a v50 system. MCP composability is v0.1.

3. **Near-zero context overhead** — An agent discovering tools through `sdkck search` uses ~200 tokens. Loading equivalent MCP schemas costs 4,000+ tokens.

## Setting Up Sidekick for Your AI Agent

### Claude Code

Add Sidekick commands to your project's `CLAUDE.md`:

```markdown
## Available CLI Tools

This project uses `sdkck` for Jira, database, and error tracking operations.

- Search for commands: `sdkck search "<query>"`
- Jira operations: `sdkck jira issue <action>`
- Database queries: `sdkck mysql query "<sql>"` or `sdkck psql query "<sql>"`
- Error tracking: `sdkck sentry issues list`

Use `sdkck search` to discover additional commands before trying to use them.
```

### Cursor / Windsurf / Other Agents

Most AI coding agents that can execute shell commands will work with Sidekick out of the box. The key is to ensure `sdkck` is available in the agent's PATH. Add a note to your project's configuration or README directing the agent to use `sdkck search` for tool discovery.

## The Agent Workflow Pattern

The ideal Sidekick workflow for an AI agent follows three steps:

### 1. Discover

```bash
sdkck search "create pull request"
```

The agent finds the right command using natural language. Semantic search (with `OPENAI_API_KEY`) understands intent, not just keywords.

### 2. Execute

```bash
sdkck bb pr create --title "Fix auth bug" --source feature/auth-fix
```

Standard CLI execution. The agent already knows how to handle stdout, stderr, exit codes, and flags.

### 3. Compose

```bash
# The agent can chain commands naturally
sdkck sentry issues list --recent | head -5
sdkck jira issue create --summary "Fix: $(sdkck sentry issue get SENTRY-123 --format oneline)"
```

Unix pipes and command substitution — no protocol overhead.

## Context Efficiency Comparison

| Approach | Tokens for Tool Discovery | Tokens for Execution | Total |
|---|---|---|---|
| MCP (load all schemas) | ~4,000+ | ~200 | ~4,200+ |
| MCP (filtered schemas) | ~1,500 | ~200 | ~1,700 |
| Sidekick CLI | ~200 | ~200 | ~400 |

**Sidekick uses up to 10x fewer tokens** for the same operations.

## Best Practices

### 1. Use Search First

Always have your agent run `sdkck search` before attempting a command it hasn't used before. This prevents hallucinated command names and flags.

### 2. Set Up Permissions

Before giving an agent access to production systems, configure permissions:

```bash
sdkck permission disallow "*"
sdkck permission allow "jira issue list"
sdkck permission allow "jira issue view"
sdkck permission allow "search"
```

### 3. Use the `--details` Flag for Agent Learning

When an agent needs to understand a command's full interface:

```bash
sdkck search "jira issue" --details
```

This returns complete help text including all flags and examples.

### 4. Enable Semantic Search

Set `OPENAI_API_KEY` in your environment to enable GPT-4o-powered search. This dramatically improves tool discovery for natural language queries.

### 5. Export Permission Configs

For reproducible agent setups:

```bash
sdkck permission export agent-permissions.json
# Commit this to your repo
# New environments: sdkck permission import agent-permissions.json
```

## Real-World Example: Bug Triage Agent

Here's a complete workflow an AI agent might execute:

```bash
# 1. Check for recent errors
sdkck sentry issues list --recent --limit 5

# 2. Get details on the top error
sdkck sentry issue get ISSUE-123

# 3. Check if a Jira ticket already exists
sdkck search "jira search"
sdkck jira issue search "sentry ISSUE-123"

# 4. Create a ticket if none exists
sdkck jira issue create \
  --project BUGS \
  --summary "Fix: NullPointerException in auth middleware" \
  --description "Sentry ISSUE-123: 450 occurrences in last 24h"

# 5. Link it in the PR
sdkck bb pr create \
  --title "fix: handle null auth token" \
  --description "Fixes BUGS-456, resolves Sentry ISSUE-123"
```

Total context used: ~1,000 tokens for discovery + execution. The equivalent MCP workflow would require 5,000+ tokens just for tool schema loading.
