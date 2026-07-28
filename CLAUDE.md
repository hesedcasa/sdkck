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
- **Claude Code plugins:** `plugins/` contains Claude Code plugin definitions (`api`, `cli`, `mcp`) — agents, skills, and hooks that extend Claude Code using sdkck itself. Not part of the TypeScript build.

## Built-in Features

### API Import (`api` topic)

`api import <source>` reads an OpenAPI spec (JSON/YAML), Postman collection, or GraphQL schema (SDL file, introspection JSON, or live endpoint) and stores each operation as a `StoredOperation`. The name defaults to the spec title slug but can be overridden with `--name`. The `init` hook (`src/hooks/init/register-api-commands.ts`) runs at startup and calls `registerApiCommands` to load every stored operation as a first-class oclif command under `<specName> <operationId>`. These dynamic commands appear in `sdkck help` and `sdkck commands` exactly like static commands.

Key files: `src/api-store.ts` (CRUD for stored specs/ops), `src/api-dynamic-commands.ts` (command factory), `src/hooks/init/register-api-commands.ts`, `src/postman-converter.ts` (Postman→OpenAPI via `@scalar/postman-to-openapi`), `src/graphql-converter.ts` (GraphQL SDL/introspection → StoredOperations).

Other subcommands: `api auth`, `api call`, `api list`, `api config`, `api remove`, `api profile`.

`api call --toon` encodes JSON responses with TOON format for token-efficient LLM consumption.

`api import --insecure` and `api config --insecure` skip TLS certificate verification — useful for self-signed certs. `--no-insecure` disables it on an already-imported spec.

**Storage layout:** stored under `<configDir>/api-<name>.json`. `readStore` also reads legacy `openapi-<name>.json` files for backward compat; `writeStore` migrates by deleting the legacy file after the first successful write.

### Permission Allowlist (`permission` topic)

`permission allow/disallow <pattern>` manages a JSON rule list at `<configDir>/permission.json`. Two hooks enforce rules:

- **Init hook** (`src/hooks/init/apply-permission.ts`): runs at startup, hides disallowed commands from `sdkck help`/`sdkck commands`, and blocks `--help` on disallowed commands via early exit.
- **Prerun hook** (`src/hooks/prerun/check-permission.ts`): safety net that blocks execution of any disallowed command that reaches the run stage.

First matching rule wins; unmatched commands are allowed. Rules use glob-style patterns against the space-separated command ID.

Key file: `src/permission-config.ts`.

Subcommands: `permission allow`, `permission disallow`, `permission list`, `permission export`, `permission import`, `permission reset`.

### MCP Server (`mcp` topic)

`mcp start` launches an MCP server (stdio by default; `--transport http --port 3000 --host 127.0.0.1` for HTTP) that exposes every sdkck CLI command as an MCP tool to any connected client (e.g. Claude Code, Cursor).

Key file: `src/mcp-server.ts`. Exports:

- `startMcpServer(config)` — entry point called by `McpStart`
- `createMcpServer(config)` — returns a configured `McpServer` instance (useful in tests)
- `buildArgv(cmd, toolArgs)` — maps MCP tool arguments → oclif argv array

Two tools are exposed: `search_tools` (keyword-indexed search over all available commands with sampling) and `run_command` (accepts command ID + args object, builds argv, runs the command).

To wire it up in Claude Code, add to `.mcp.json`:

```json
{"mcpServers": {"sdkck": {"command": "./bin/run.js", "args": ["mcp", "start"]}}}
```

Dep: `@modelcontextprotocol/sdk` (^1.29.0). No extra peer dep installs needed.

### MCP HTTP Authentication (`mcp token` subtopic)

`mcp token generate` creates a random Bearer token stored in `<configDir>/mcp-auth.json`; the HTTP transport enforces it automatically. `mcp token show` displays the current token; `mcp token delete` removes it (disabling auth).

### MCP Client (`mcp client` subtopic)

`mcp client add <name> --command <cmd>` connects to an external MCP server (stdio via `--command`/`--args`/`--env`, or HTTP via `--url`/`--header`) and registers its tools as native sdkck CLI commands. Tools are cached; `mcp client list [--tools]` shows configured servers. `mcp client auth`, `mcp client refresh`, and `mcp client remove` manage credentials and lifecycle.

Key file: `src/mcp-client-store.ts`.

### Telemetry (OpenTelemetry)

Every command execution is instrumented with OpenTelemetry: a trace span per command, a per-command counter + duration histogram, and — when a command throws — an exception event (error trace) plus an error counter.

The `setup-telemetry` init hook (`src/hooks/init/setup-telemetry.ts`) initialises the providers and wraps the root config's `runCommand` (the single dispatch point every command flows through), so both successful completions and thrown errors are captured, including nested `config.runCommand` calls. Wrapping `runCommand` — rather than `Command.prototype._run` — is deliberate: JIT/user plugins (every `@hesed/*`) are installed under the oclif **data dir** and resolve their _own_ copy of `@oclif/core`, so a prototype wrapped in the CLI's copy would never cover them. All commands are dispatched through the root config's `runCommand`, so one wrap there instruments built-in and data-dir plugin commands alike. Because the CLI is short-lived, metrics are force-flushed when the outermost command finishes rather than on a timer. Note: this covers every command that actually executes (including the `help` command); oclif's bare root `--help`/`--version` flags short-circuit before `runCommand`, so those specific invocations are not counted.

`this.exit(code)` throws an oclif `ExitError` to unwind the stack; a zero code is treated as success, a non-zero code as a failure (tagged `command.exit_code`) rather than an exception with a stack.

Key file: `src/telemetry.ts`. Exports: `initTelemetry`, `instrumentCommand`, `shutdownTelemetry` (plus `isTelemetryActive`/`resetTelemetryForTests` test helpers).

Emitted instruments: `sdkck.command.count`, `sdkck.command.duration` (ms), `sdkck.command.errors`. Spans carry `command.id`, `command.plugin`, and `command.argc` attributes.

**Safe by default:** because spans can be shipped off the machine, potentially secret-bearing values are not captured unless explicitly opted in. Command arguments are reduced to a count (`command.argc`) and failures record only the exception _type_. Opt in with `SDKCK_OTEL_CAPTURE_ARGV=1` (attach the full `command.argv`) and `SDKCK_OTEL_CAPTURE_ERRORS=1` (attach exception messages + stack traces).

Exporter selection (chosen at startup so the CLI stays network-free by default):

- `OTEL_EXPORTER_OTLP_ENDPOINT` (or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` / `..._METRICS_ENDPOINT`) → OTLP/HTTP.
- `OTEL_TRACES_EXPORTER=console` / `OTEL_METRICS_EXPORTER=console` → stdout (per signal).
- otherwise → newline-delimited JSON files at `<configDir>/logs/otel-traces.jsonl` and `<configDir>/logs/otel-metrics.jsonl` (the file metric exporter uses delta temporality so each flush records only new activity).

Set `SDKCK_OTEL_DISABLED=true` to turn instrumentation off for sdkck only (leaving the standard `OTEL_SDK_DISABLED` that other host tools honour untouched), `OTEL_SDK_DISABLED=true` to turn it off entirely, or `OTEL_DEBUG=1` for OTel diagnostic logging.

### Agent Vault SDK (`src/agent-vault/`)

A TypeScript client for [Infisical Agent Vault](https://github.com/Infisical/agent-vault), a credential broker that keeps real secrets out of agent processes. Agent Vault runs a management API (`:14321`) and a transparent MITM proxy (`:14322`); traffic sent through the proxy has the real credential substituted in flight, so the caller only ever holds a scoped session token.

This is the interception/injection half of the upstream SDK — credential resolution plus proxy configuration. Vault, credential and service-rule management is not implemented here; configure those through the Agent Vault CLI or dashboard.

```typescript
import {AgentVault} from 'sdkck'

const av = new AgentVault({address: 'http://localhost:14321', token: 'av_agt_...'})

// Resolve a proxy credential, write the root CA, and route outbound requests through the proxy
const {certPath, env, mode} = await av.vault('my-project').intercept({ttlSeconds: 3600})

// From here a plain request is intercepted and the credential injected:
await fetch('https://api.stripe.com/v1/charges') // no key in this process
```

**Two credential modes** (`intercept({mode})`), mirroring the two modes of `agent-vault run`:

<!-- prettier-ignore -->
| mode | credential | needs |
| --- | --- | --- |
| `session` | mints a short-lived scoped token (`POST /v1/sessions`) | a `member`/`admin` token |
| `agent` | uses the configured token directly, validated via `GET /discover` | any `proxy`-role token |
| `auto` (default) | tries `session`, falls back to `agent` on 403 | anything that can proxy |

Why both: the server ranks roles `proxy: 0 < member: 1 < admin: 2` and **refuses to mint from a `proxy`-role caller** — `handle_sessions.go` says a proxy-role caller "can ONLY proxy requests through Agent Vault — they cannot mint new tokens, even at proxy role." Since `proxy` is also the role minting _produces_, an agent token granted `proxy` is already a finished proxy credential; asking it to mint is circular and 403s. `auto` therefore prefers a scoped session (shorter-lived, strictly better) and falls back to using the token as-is, so both token types work with no configuration. A non-403 mint failure always propagates — a 401 or 5xx must never be mistaken for "this token may only proxy".

Key files: `src/agent-vault/client.ts` (`AgentVault` — instance-level, `vault(name)` scopes via the `X-Vault` header), `src/agent-vault/vault.ts` (`VaultClient`, `intercept()`), `src/agent-vault/resources/sessions.ts` (`POST /v1/sessions`, `buildProxyEnv`), `src/agent-vault/resources/mitm.ts` (CA fetch from `/v1/mitm/ca.pem`, `X-MITM-Port`, `buildContainerConfig` — shared by both modes), `src/agent-vault/resources/discover.ts` (`GET /discover` — agent-mode token validation), `src/agent-vault/proxy.ts` (`interceptRequests`, `writeCaCertificate`, `applyProxyEnv`), `src/agent-vault/http.ts` (fetch wrapper: bearer auth, timeout, `ApiError` mapping), `src/agent-vault/errors.ts`.

Everything is re-exported from `src/index.ts`, so the package doubles as a library. No new dependencies — the client is built on the global `fetch`.

Notes:

- **Token/address resolution:** explicit config > `AGENT_VAULT_TOKEN` / `AGENT_VAULT_ADDR` > `http://localhost:14321` (a missing token throws `AgentVaultError`).
- **`buildProxyEnv`** sets `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY`, `NODE_USE_ENV_PROXY=1`, `OPENCLAW_PROXY_URL`, and the CA trust variables for Node, Python, curl, Git and Deno (`SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS`, `REQUESTS_CA_BUNDLE`, `CURL_CA_BUNDLE`, `GIT_SSL_CAINFO`, `DENO_CERT`) — keep it in sync with `augmentEnvWithMITM()` server-side.
- **Scope of interception:** `intercept()` mutates `process.env` by default, so child processes are covered unconditionally; this process's own `fetch` only honours the proxy variables on Node v22.21.0+ and only when they are set before the first request. Pass `env: {}` to build a child-process environment without touching the current one, and `certPath` to target a container mount path.
- **MITM disabled:** only a 404 from `/v1/mitm/ca.pem` means MITM is off — `MitmResource.info()` then resolves `null`, `sessions.create()` returns `containerConfig: null`, and `interceptRequests` treats that as an error since there is nothing to intercept. Any other failure throws instead of being mistaken for "MITM is off", and is not cached, so the next call retries. (Upstream's SDK returns `null` on _any_ failure and caches it forever; this client deliberately does neither.)
- **`applyProxyEnv` clears other spellings** of the keys it sets before assigning — an inherited lowercase `https_proxy` would otherwise win in curl and libcurl-backed Python, silently routing around the broker. Mirrors `stripEnvKeys(env, mitmInjectedKeys)` server-side. Only variants of keys actually being set are removed.
- **Certificate writes:** `writeCaCertificate` unlinks whatever is at `certPath` (removing a symlink itself, not its target) and then creates the file with `O_EXCL`, so the write is never redirected through a link — on Windows too, where `O_NOFOLLOW` does not exist. The default path lives in a private per-process directory (`defaultCertPath()`) instead of a predictable name in the shared temp directory.
- Errors: `ApiError` (non-2xx control-plane responses, carrying `status`/`code`) extends `AgentVaultError` (missing token, network failure, timeout).

#### Intercepting every command (`setup-agent-vault` init hook)

With `AGENT_VAULT_TOKEN` and `AGENT_VAULT_VAULT` both set, every sdkck invocation runs with its outbound traffic brokered: the `setup-agent-vault` init hook (`src/hooks/init/setup-agent-vault.ts`) resolves a proxy credential (`auto` mode — see above), writes the root CA to a temporary directory, and **re-executes the same invocation** with the proxy environment applied, then exits with the child's status.

The re-exec is the point. Node reads `NODE_USE_ENV_PROXY` and `NODE_EXTRA_CA_CERTS` at process startup, so a process cannot proxy its own `fetch` by mutating `process.env` — verified: pre-start env makes `fetch` dial the proxy, while a runtime mutation goes straight out to DNS. Running the command in a process that _started_ with the environment covers in-process `fetch`, every plugin's HTTP, and any subprocess (git, curl, python), in one mechanism.

Key file: `src/agent-vault-process.ts` — `shouldIntercept(env)` decides whether to intercept and which vault to use; `runIntercepted(options)` does the resolve/write/spawn and resolves with the child's exit code (everything is injectable for tests).

- **Fails closed:** if no proxy credential can be resolved — the token is rejected, the vault does not exist, MITM is off — the command does not run at all (exit 1) rather than sending unbrokered requests. `SDKCK_AGENT_VAULT_DISABLED=1` is the escape hatch.
- **The child does not get `AGENT_VAULT_TOKEN`:** it is deleted from the child's environment; the proxy credential rides inside the proxy URL instead. `SDKCK_AGENT_VAULT_ACTIVE=1` marks the child so it does not intercept itself again. Note the withholding only buys something in `session` mode, where the child gets a short-lived scoped token rather than the instance token — in `agent` mode the same long-lived token is in `HTTPS_PROXY` regardless. The side effect is that the child cannot run `agent-vault vault proposal create` to request new access, which upstream's `agent-vault run` supports by passing the token through.
- **Cost:** one extra process spawn per invocation, plus one credential resolution (a mint attempt, and in agent mode a `/discover` check). Nothing is cached to disk, so no token is ever persisted.
- Exit codes and stdio pass through verbatim (the child inherits stdio; a signal-terminated child reports `128 + signum`).

## JIT Plugins

The `oclif.jitPlugins` field in `package.json` declares plugins that are auto-installed on first use (e.g., `@hesed/mcp-server`, `@hesed/mcp-client`, `@hesed/jira`, `@hesed/conni`, `@hesed/bb`, `@hesed/sentry`, `@hesed/mysql`, `@hesed/psql`, `@hesed/supabase`). When a JIT plugin's command is invoked, the `jit_plugin_not_installed` hook (`src/hooks/jit_plugin_not_installed/jit-install.ts`) runs `plugins:install <pluginName>@<pluginVersion>` automatically.

The MCP server (`mcp start`, `mcp token …`) and MCP client (`mcp client …`) live in the JIT plugins `@hesed/mcp-server` and `@hesed/mcp-client`. Because `bin/run.js`/`bin/dev.js` register the MCP client's dynamic tool commands at startup, they import `@hesed/mcp-client` via a guarded dynamic `import()` — when the plugin isn't installed yet the CLI still starts, and the dynamic commands appear once it's auto-installed on first `mcp client` use.

## Testing Patterns

Tests directly instantiate command/hook classes rather than using `@oclif/test`'s `runCommand`. The mock config passed to commands must include `runHook: async () => ({failures: [], successes: []})` to satisfy oclif's internal requirements. Use `Parameters<typeof hook>[0]` to extract hook option types for type-safe test helpers.

Commands that depend on external clients (e.g., `Search._llmClient`) use public properties for dependency injection — set them directly in tests to exercise different code paths without real API calls.

## Environment

- **`AGENT_VAULT_TOKEN` / `AGENT_VAULT_ADDR`:** Default token and management API address for the Agent Vault SDK (`src/agent-vault/`). The address falls back to `http://localhost:14321`; a missing token throws.
- **`AGENT_VAULT_VAULT`:** Vault to broker credentials from. Setting it together with `AGENT_VAULT_TOKEN` turns on command-wide interception (see the Agent Vault section). `SDKCK_AGENT_VAULT_DISABLED=1` skips it for one invocation; `SDKCK_AGENT_VAULT_ACTIVE` is set internally on the re-executed child and should not be set by hand.
- **`OPENAI_API_KEY`:** Required to enable LLM-powered semantic search in `sdkck search`. When unset, search falls back to fuzzy matching. The search command uses `gpt-4o` via the `openai` npm package.
- **OpenTelemetry toggles:** `OTEL_EXPORTER_OTLP_ENDPOINT` (send traces/metrics to an OTLP/HTTP collector), `OTEL_TRACES_EXPORTER=console` / `OTEL_METRICS_EXPORTER=console` (export to stdout, per signal), `SDKCK_OTEL_DISABLED=true` (disable for sdkck only), `OTEL_SDK_DISABLED=true` (disable instrumentation entirely), `OTEL_DEBUG=1` (OTel diagnostic logging), `SDKCK_OTEL_CAPTURE_ARGV=1` / `SDKCK_OTEL_CAPTURE_ERRORS=1` (opt in to capturing raw arguments / exception messages + stacks, which may contain secrets). See the Telemetry section above. Defaults to JSON files under `<configDir>/logs/`.

## Gotchas

- **Lint false-positive after build:** `npm run build` wipes `dist/`, so the `posttest` lint step always errors on `bin/run.js` (`Unable to resolve path to module '../dist/api-dynamic-commands.js'`). Pre-existing; not a regression.
- **`@scalar/openapi-parser` peer dep:** Installing this package also requires `npm install @scalar/types` explicitly — npm does not auto-install it.
- **`@scalar/postman-to-openapi` peer dep:** Same pattern — also requires `npm install @scalar/types` explicitly.
- **`extractOperations` expects a dereferenced spec:** Call `loadSpec` (which runs `dereference` internally) before passing a spec to `extractOperations`. Tests that call `extractOperations` directly should use inline specs without `$ref`s.
- **`run_command` accepts both separators:** the MCP tool accepts command IDs with either spaces (`"api import"`) or colons (`"api:import"`) — both resolve to the same command.

## Conventions

- **Node version:** v22 (see `.nvmrc`). Build uses this version; tests run against Node 22–24.
- **Package manager:** npm only (yarn.lock and pnpm-lock.yaml are gitignored).
- **PR titles** must follow [Conventional Commits](https://www.conventionalcommits.org/) (enforced by CI).
- **Releases** managed via [release-please](https://github.com/googleapis/release-please).
- **Dead code:** Run `npm run find-deadcode` (ts-prune) to detect unused exports. `run` and `default` exports are ignored.
- **Pre-commit:** `npm run pre-commit` runs format + dead code check (not enforced by a git hook, run manually).
