# Sidekick (sdkck) Wiki

Welcome to the official Sidekick wiki — the comprehensive user guide for the best companion tool for AI agents.

Sidekick is an agentic CLI that gives AI coding agents (like Claude Code, Cursor, Windsurf, and others) instant access to your entire development stack through a single, lightweight command-line interface. No MCP overhead. No context window bloat. Just commands that work.

## Quick Navigation

| Page                                         | Description                                      |
| -------------------------------------------- | ------------------------------------------------ |
| [Installation Guide](Installation-Guide)     | Setup instructions for all platforms             |
| [Plugin System](Plugin-System)               | How JIT plugins and the plugin ecosystem work    |
| [Permission System](Permission-System)       | Fine-grained access control for agent safety     |
| [AI Agent Integration](AI-Agent-Integration) | Best practices for using Sidekick with AI agents |
| [Creating Plugins](Creating-Plugins)         | Build your own Sidekick plugins                  |

## What Makes Sidekick Different?

1. **Zero Context Overhead** — Unlike MCP servers that load hundreds of tool schemas into your agent's context window, Sidekick uses CLI conventions that LLMs already understand natively. Your agent discovers tools with `sdkck search` and uses them immediately.

2. **Just-In-Time Plugins** — Plugins install automatically on first use. No upfront configuration. Run `sdkck jira issue list` and the Jira plugin appears like magic.

3. **Permission System** — Enterprise-grade access control. Define exactly which commands your agent can run, export configs for your team, and sleep well at night.

4. **Plugin Ecosystem** — Jira, Bitbucket, Sentry, MySQL, PostgreSQL, Supabase, Confluence — and growing. Each plugin is a focused, well-tested npm package.

## Quick Start

```bash
npm install -g sdkck
sdkck search "create issue"
sdkck jira issue create --project MYPROJ --summary "My first ticket"
```

That's it. The Jira plugin installs on the first invocation. No config files. No server setup.

## Getting Help

- [GitHub Issues](https://github.com/hesedcasa/sdkck/issues) — Report bugs and request features
- [Blog: Getting Started](https://dev.to/allentcm/getting-started-with-sidekick-sdkck-a-complete-setup-guide-460m) — Complete setup guide
- [Blog: Why CLI over MCP](https://dev.to/allentcm/why-i-switched-from-mcp-to-cli-3ifb) — Understanding the CLI-first approach
