# Permission System

Sidekick's permission system provides fine-grained access control over which commands can be executed. This is essential for safe AI agent usage — you can precisely define what your agent is allowed to do.

## How It Works

Permissions are stored in `$XDG_CONFIG_HOME/sdkck/permission.json` (typically `~/.config/sdkck/permission.json`). The system uses a **first-match-wins** rule evaluation strategy, and commands are allowed by default if no rule matches.

### Rule Evaluation

1. When a command runs, Sidekick checks it against the permission rules in order
2. The first matching rule determines whether the command is allowed or blocked
3. If no rule matches, the command is **allowed** (default-open)

### Permission Enforcement Points

Permissions are enforced at two stages:

- **Init hook**: Hides disallowed commands from `help` and `commands` output, blocking even `--help` flags on disallowed commands
- **Prerun hook**: Safety net that blocks execution of disallowed commands that somehow bypass the init stage

## Pattern Matching

Sidekick supports four types of permission patterns:

| Pattern               | Matches                       | Example                                        |
| --------------------- | ----------------------------- | ---------------------------------------------- |
| `"*"`                 | All commands                  | Everything in the CLI                          |
| `"jira"`              | Exact command + all subtopics | `jira`, `jira issue list`, `jira issue create` |
| `"jira *"`            | Explicit wildcard             | Same as above but using wildcard syntax        |
| `"jira issue create"` | Exact command ID              | Only `jira issue create`                       |

## Commands

### Allow a Pattern

```bash
sdkck permission allow "*"                    # Allow everything
sdkck permission allow jira                   # Allow all Jira commands
sdkck permission allow "jira *"               # Allow all Jira commands (wildcard)
sdkck permission allow "jira issue create"    # Allow only issue creation
```

### Disallow a Pattern

```bash
sdkck permission disallow "*"                 # Block everything
sdkck permission disallow "mysql *"           # Block all MySQL commands
sdkck permission disallow "jira issue delete" # Block issue deletion
```

### List Rules

```bash
sdkck permission list
```

Displays all rules with indicators:

- `✓` — Allowed
- `✗` — Disallowed

### Export and Import

Share permission configurations across your team:

```bash
# Export to JSON
sdkck permission export permissions.json

# Import from JSON
sdkck permission import permissions.json
```

### Reset

```bash
sdkck permission reset           # With confirmation prompt
sdkck permission reset --confirm # Skip confirmation
```

## Recipes for AI Agent Safety

### Read-Only Agent

```bash
sdkck permission disallow "*"
sdkck permission allow "jira issue list"
sdkck permission allow "jira issue view"
sdkck permission allow "sentry issues list"
sdkck permission allow "search"
```

### Full Jira Access, No Database

```bash
sdkck permission allow "jira *"
sdkck permission disallow "mysql *"
sdkck permission disallow "psql *"
```

### CI/CD Agent with Limited Scope

```bash
sdkck permission allow "bb pr create"
sdkck permission allow "bb pr merge"
sdkck permission allow "jira issue transition"
sdkck permission disallow "*"
```

Note: Because Sidekick uses **first-match-wins**, put your specific allow rules **before** the catch-all disallow rule.

## Team Configuration

For team environments, we recommend:

1. Create a `permissions.json` for each role (developer, CI agent, on-call, etc.)
2. Store these in your team's shared config repository
3. Import the appropriate config during agent setup: `sdkck permission import role-dev.json`
4. Export and audit periodically: `sdkck permission export audit-$(date +%Y%m%d).json`
