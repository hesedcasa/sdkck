# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`sdkck` is an agentic CLI built on the [oclif](https://oclif.io) framework that provides tools via a plugin architecture. It uses ESM modules, TypeScript with strict mode, and targets ES2022.

## Common Commands

- **Build:** `npm run build` (cleans `dist/` and compiles TypeScript)
- **Test:** `npm run test` (runs mocha, then lint via `posttest`)
- **Run single test:** `npx mocha --forbid-only "test/path/to/file.test.ts"`
- **Lint:** `npm run lint` (ESLint with oclif + prettier configs)
- **Format:** `npm run format` (ESLint --fix + Prettier write)
- **Dev run:** `./bin/dev.js <command>` (runs CLI from source via ts-node, no build needed)
- **Production run:** `./bin/run.js <command>` (runs from compiled `dist/`)
- **Generate manifest:** `npx oclif manifest` (creates `oclif.manifest.json` for packaging)

## Architecture

- **Framework:** oclif v4 — commands are auto-discovered from `src/commands/` (compiled to `dist/commands/`). Each file exports a class extending `Command`.
- **Entry points:** `bin/run.js` (production), `bin/dev.js` (development with ts-node/esm loader)
- **Plugin system:** Uses oclif's built-in plugin architecture (`@oclif/plugin-plugins`, `@oclif/plugin-update`, etc.). Third-party plugins are loaded via `@oclif/plugin-*` glob in package.json `oclif.plugins`.
- **Topic separator:** Space-based (`topicSeparator: " "`), so commands use `sdkck topic command` not `sdkck topic:command`.
- **Module system:** ESM (`"type": "module"` in package.json, `"module": "Node16"` in tsconfig)

## Built-in Features

### OpenAPI Import (`openapi` topic)

`openapi import <source>` reads an OpenAPI spec (JSON/YAML) or Postman collection and stores each operation in `~/.local/share/sdkck/openapi/<name>/`. The name defaults to the spec title slug but can be overridden with `--name`. The `init` hook (`src/hooks/init/register-openapi-commands.ts`) runs at startup and calls `registerOpenApiCommands` to load every stored operation as a first-class oclif command under `<specName> <operationId>`. These dynamic commands appear in `sdkck help` and `sdkck commands` exactly like static commands.

Key files: `src/openapi-store.ts` (CRUD for stored specs/ops), `src/openapi-dynamic-commands.ts` (command factory), `src/hooks/init/register-openapi-commands.ts`, `src/postman-converter.ts` (Postman→OpenAPI via `@scalar/postman-to-openapi`).

Other subcommands: `openapi auth`, `openapi call`, `openapi list`, `openapi config`, `openapi remove`.

### Permission Allowlist (`permission` topic)

`permission allow/disallow <pattern>` manages a JSON rule list at `<configDir>/permission.json`. The `prerun` hook (`src/hooks/prerun/check-permission.ts`) enforces rules before every command runs — first matching rule wins; unmatched commands are allowed. Rules use glob-style patterns against the space-separated command ID.

Key file: `src/permission-config.ts`.

Subcommands: `permission allow`, `permission disallow`, `permission list`, `permission export`, `permission import`, `permission reset`.

## JIT Plugins

The `oclif.jitPlugins` field in `package.json` declares plugins that are auto-installed on first use (e.g., `@hesed/jira`, `@hesed/conni`, `@hesed/bb`, `@hesed/sentry`, `@hesed/mysql`, `@hesed/psql`, `@hesed/supabase`). When a JIT plugin's command is invoked, the `jit_plugin_not_installed` hook (`src/hooks/jit_plugin_not_installed/jit-install.ts`) runs `plugins:install <pluginName>@<pluginVersion>` automatically.

## Testing Patterns

Tests directly instantiate command/hook classes rather than using `@oclif/test`'s `runCommand`. The mock config passed to commands must include `runHook: async () => ({failures: [], successes: []})` to satisfy oclif's internal requirements. Use `Parameters<typeof hook>[0]` to extract hook option types for type-safe test helpers.

Commands that depend on external clients (e.g., `Search._llmClient`) use public properties for dependency injection — set them directly in tests to exercise different code paths without real API calls.

## Environment

- **`OPENAI_API_KEY`:** Required to enable LLM-powered semantic search in `sdkck search`. When unset, search falls back to fuzzy matching. The search command uses `gpt-4o` via the `openai` npm package.

## Gotchas

- **Lint false-positive after build:** `npm run build` wipes `dist/`, so the `posttest` lint step always errors on `bin/run.js` (`Unable to resolve path to module '../dist/openapi-dynamic-commands.js'`). Pre-existing; not a regression.
- **`@scalar/openapi-parser` peer dep:** Installing this package also requires `npm install @scalar/types` explicitly — npm does not auto-install it.
- **`@scalar/postman-to-openapi` peer dep:** Same pattern — also requires `npm install @scalar/types` explicitly.
- **`extractOperations` expects a dereferenced spec:** Call `loadSpec` (which runs `dereference` internally) before passing a spec to `extractOperations`. Tests that call `extractOperations` directly should use inline specs without `$ref`s.

## Conventions

- **Node version:** v22 (see `.nvmrc`). Build uses this version; tests run against Node 22–24.
- **Package manager:** npm only (yarn.lock and pnpm-lock.yaml are gitignored).
- **PR titles** must follow [Conventional Commits](https://www.conventionalcommits.org/) (enforced by CI).
- **Releases** managed via [release-please](https://github.com/googleapis/release-please).
- **Dead code:** Run `npm run find-deadcode` (ts-prune) to detect unused exports. `run` and `default` exports are ignored.
- **Pre-commit:** `npm run pre-commit` runs format + dead code check (not enforced by a git hook, run manually).
