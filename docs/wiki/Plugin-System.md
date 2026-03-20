# Plugin System

Sidekick's plugin system is what makes it the best companion tool for AI agents. It provides a modular, extensible architecture where each integration is a self-contained npm package that installs and loads on demand.

## How JIT Plugins Work

JIT (Just-In-Time) plugins are the core innovation of Sidekick. Instead of requiring you to install every integration upfront, plugins are declared in the CLI configuration and **automatically installed the first time you use them**.

### The Flow

1. You (or your AI agent) runs `sdkck jira issue list`
2. Sidekick checks if `@hesed/jira` is installed
3. If not, the `jit_plugin_not_installed` hook fires
4. The hook runs `plugins:install @hesed/jira@^0.2.0` automatically
5. The original command executes as if the plugin was always there

### Built-in JIT Plugins

| Plugin | Version | Integration |
|---|---|---|
| `@hesed/jira` | ^0.2.0 | Atlassian Jira issue tracking |
| `@hesed/conni` | ^0.2.0 | Atlassian Confluence wiki |
| `@hesed/bb` | ^0.2.0 | Bitbucket repositories and PRs |
| `@hesed/sentry` | ^0.2.0 | Sentry error tracking |
| `@hesed/mysql` | ^0.2.0 | MySQL database operations |
| `@hesed/psql` | ^0.2.0 | PostgreSQL database operations |
| `@hesed/supabase` | ^0.2.0 | Supabase project management |

## Installing Additional Plugins

Beyond JIT plugins, you can install any compatible oclif plugin:

```bash
# From npm registry
sdkck plugins install myplugin

# From GitHub
sdkck plugins install https://github.com/someuser/someplugin

# From GitHub shorthand
sdkck plugins install someuser/someplugin
```

## Managing Plugins

```bash
# List installed plugins
sdkck plugins

# Inspect a plugin's details
sdkck plugins inspect @hesed/jira

# Update all plugins
sdkck plugins update

# Remove a plugin
sdkck plugins remove @hesed/jira

# Reset all plugins (nuclear option)
sdkck plugins reset
sdkck plugins reset --hard  # Also removes node_modules
```

## Plugin Discovery with Search

Sidekick's `search` command is the primary way AI agents discover available commands across all plugins:

```bash
# Fuzzy search (always available)
sdkck search "create issue"

# Semantic search (requires OPENAI_API_KEY)
sdkck search "find recent production errors"

# Detailed output with full help text
sdkck search "jira" --details
```

### How Search Works

- **Fuzzy mode** (default): Uses a gap-penalty scoring algorithm that rewards word-boundary matches. Works offline, zero latency.
- **Semantic mode** (with `OPENAI_API_KEY`): Sends the query and available commands to GPT-4o for intelligent ranking. Understands intent, not just keywords.

This dual-mode search is what makes Sidekick so efficient for AI agents — they can discover the right command with a single call, using minimal context tokens.

## Plugin Architecture

Each Sidekick plugin is an oclif plugin — an npm package that exports command classes. The oclif framework handles discovery, loading, and lifecycle management.

Key points:
- Commands are auto-discovered from the plugin's `commands/` directory
- The space-based topic separator means commands read naturally: `sdkck jira issue create`
- Plugins can define their own hooks for lifecycle events
- User-installed plugins override core plugins (useful for development)
