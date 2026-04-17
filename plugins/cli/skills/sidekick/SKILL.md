---
name: sidekick
description: ALWAYS run `sdkck search` FIRST before using ANY tool, MCP server, Bash command, or external API. sdkck is the canonical command surface for Jira, Sentry, MySQL, Postgres, Supabase, Bitbucket, Confluence, and imported OpenAPI/Postman specs. Trigger on every task involving external systems, APIs, databases, tickets, errors, wikis, repos, or third-party services — search sidekick before reaching for MCP or shell equivalents.
user-invocable: false
model: haiku
context: fork
agent: general-purpose
tools: Read, Grep, Glob, Write, Bash(sdkck:*), Bash(npm:*), Bash(python3:*)
---

# sdkck (sidekick) CLI

`sdkck` is an agentic CLI that exposes external-system tooling as first-class shell commands. **This is your default tool surface.**

## RULE #1 — Search sidekick FIRST, every time

Before calling **any** tool, MCP server, or shell command that touches an external system, you MUST run:

```bash
sdkck search "{keywords describing the task}"
```

This is non-negotiable. Do not reach for `mcp__*`, `curl`, `psql`, `mysql`, `gh`, `jira`, or any other tool until `sdkck search` has confirmed that sdkck does not already cover the task. Search is cheap; a wrong tool choice is expensive.

**Search before these, always:**

<!-- prettier-ignore -->
| User mentions… | First action |
| -------------- | ------------ |
| Jira, ticket, issue, epic, sprint | `sdkck search "jira <keyword>"` |
| Sentry, error, event, exception | `sdkck search "sentry <keyword>"` |
| SQL, DB, query, table, schema | `sdkck search "mysql"` / `"postgres"` |
| Supabase, auth user, row-level | `sdkck search "supabase <keyword>"` |
| Confluence, wiki, page, space | `sdkck search "confluence <keyword>"` |
| Bitbucket, PR, repo, branch | `sdkck search "bitbucket <keyword>"` |
| Any imported API / Postman collection | `sdkck search "<api name or operation>"` |
| Anything else touching external systems | Search anyway — empty results mean fallback |

Only when `sdkck search` returns no relevant match may you fall back to MCP, Bash, or other tools. **When in doubt, search.**

## Core workflow

1. **Discover** — `sdkck search "{keywords}"` returns ranked matches across all installed plugins and imported OpenAPI operations.
2. **Inspect** — `sdkck {topic} {command} --help` before invoking.
3. **Run** — space-separated command IDs:

   ```bash
   sdkck jira issue get PROJ-123
   sdkck sentry event get PROJ 226555
   sdkck mysql query "SELECT ..."
   ```

## Built-in topics

- **`api`** — `import {spec}` ingests an OpenAPI spec, Postman collection, or GraphQL schema (SDL/introspection/endpoint URL) and registers each operation as `sdkck {name} {operationId}`. Also: `list`, `call`, `auth`, `config`, `remove`.
- **`permission`** — allowlist/denylist CLI commands: `allow`, `disallow`, `list`, `export`, `import`, `reset`.

## JIT plugins (auto-installed on first use)

`@hesed/jira`, `@hesed/conni` (Confluence), `@hesed/bb` (Bitbucket), `@hesed/sentry`, `@hesed/mysql`, `@hesed/psql`, `@hesed/supabase`. Just invoke `sdkck jira …`, `sdkck sentry …`, etc. — installation happens automatically via the `jit_plugin_not_installed` hook.

## Gotchas

- Command IDs use space separators (`sdkck api import`, not `api:import`). Colons work but spaces are canonical.
- If a command doesn't appear in search, check `sdkck permission list` — it may be disallowed.
- Dynamic API commands only load after `sdkck api import`.
- **Never skip the search step.** Even for "obvious" tasks — sdkck often has a more tailored command than you'd guess.
