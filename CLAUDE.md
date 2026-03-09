# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`sdkck` is an agentic CLI built on the [oclif](https://oclif.io) framework that provides tools via a plugin architecture. It uses ESM modules, TypeScript with strict mode, and targets ES2022.

## Common Commands

- **Build:** `npm run build` (cleans `dist/` and compiles TypeScript)
- **Test:** `npm run test` (runs mocha, then lint via `posttest`)
- **Run single test:** `npx mocha --forbid-only "test/path/to/file.test.ts"`
- **Lint:** `npm run lint` (ESLint with oclif + prettier configs)
- **Dev run:** `./bin/dev.js <command>` (runs CLI from source via ts-node, no build needed)
- **Production run:** `./bin/run.js <command>` (runs from compiled `dist/`)
- **Generate manifest:** `npx oclif manifest` (creates `oclif.manifest.json` for packaging)

## Architecture

- **Framework:** oclif v4 — commands are auto-discovered from `src/commands/` (compiled to `dist/commands/`). Each file exports a class extending `Command`.
- **Entry points:** `bin/run.js` (production), `bin/dev.js` (development with ts-node/esm loader)
- **Plugin system:** Uses oclif's built-in plugin architecture (`@oclif/plugin-plugins`, `@oclif/plugin-update`, etc.). Third-party plugins are loaded via `@oclif/plugin-*` glob in package.json `oclif.plugins`.
- **Topic separator:** Space-based (`topicSeparator: " "`), so commands use `sdkck topic command` not `sdkck topic:command`.
- **Module system:** ESM (`"type": "module"` in package.json, `"module": "Node16"` in tsconfig)

## JIT Plugins

The `oclif.jitPlugins` field in `package.json` declares plugins that are auto-installed on first use (e.g., `@hesed/jira`, `@hesed/conni`, `@hesed/bb`, `@hesed/sentry`, `@hesed/mysql`, `@hesed/psql`, `@hesed/supabase`). When a JIT plugin's command is invoked, the `jit_plugin_not_installed` hook (`src/hooks/jit_plugin_not_installed/jit-install.ts`) runs `plugins:install <pluginName>@<pluginVersion>` automatically.

## Testing Patterns

Tests directly instantiate command/hook classes rather than using `@oclif/test`'s `runCommand`. The mock config passed to commands must include `runHook: async () => ({failures: [], successes: []})` to satisfy oclif's internal requirements. Use `Parameters<typeof hook>[0]` to extract hook option types for type-safe test helpers.

Commands that depend on external clients (e.g., `Search._llmClient`) use public properties for dependency injection — set them directly in tests to exercise different code paths without real API calls.

## Environment

- **`OPENAI_API_KEY`:** Required to enable LLM-powered semantic search in `sdkck search`. When unset, search falls back to fuzzy matching. The search command uses `gpt-4o` via the `openai` npm package.

## Conventions

- **Node version:** v22 (see `.nvmrc`). Build uses this version; tests run against Node 22–24.
- **Package manager:** npm only (yarn.lock and pnpm-lock.yaml are gitignored).
- **PR titles** must follow [Conventional Commits](https://www.conventionalcommits.org/) (enforced by CI).
- **Releases** managed via [release-please](https://github.com/googleapis/release-please).
- **Dead code:** Run `npm run find-deadcode` (ts-prune) to detect unused exports. `run` and `default` exports are ignored.
- **Pre-commit:** `npm run pre-commit` runs format + dead code check (not enforced by a git hook, run manually).
