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

## Conventions

- **Node version:** v22 (see `.nvmrc`). Build uses this version; tests run against Node 22–24.
- **Package manager:** npm only (yarn.lock and pnpm-lock.yaml are gitignored).
- **PR titles** must follow [Conventional Commits](https://www.conventionalcommits.org/) (enforced by CI).
- **Releases** managed via [release-please](https://github.com/googleapis/release-please).
