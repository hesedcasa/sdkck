# Infisical platform Agent Vault support in sdkck — Design

- **Date:** 2026-09-28
- **Status:** Approved (design discussion 2026-09-28)
- **Scope:** Hook + SDK — extend `src/agent-vault/` and the `setup-agent-vault` init hook so sdkck runs brokered through the **Infisical SaaS platform Agent Vault** proxy, coexisting with the existing OSS-broker support via auto-detection.

## 1. Background

Two related but distinct products share the "Agent Vault" name:

| | OSS broker (`github.com/Infisical/agent-vault`) | Infisical platform Agent Vault (`app.infisical.com`) |
| --- | --- | --- |
| What it is | Self-hosted single Go binary: management API on `:14321`, MITM proxy on `:14322` | SaaS feature: access bundles, sessions, enrolled forward proxies on `:17323` |
| Token | `av_agt_…` instance/agent token; scoped sessions minted via `POST /v1/sessions` | `agv_…` session token issued by the dashboard (or implicitly by `infisical agent-vault run`) |
| CA | `GET /v1/mitm/ca.pem` (raw PEM), `X-MITM-Port` header | `GET http://<proxy>/_agent-vault/ca` → JSON, certificate in `.certificate` |
| Proxy auth | HTTP Basic: token as username, vault as password | Proxy userinfo: username `x-agent-vault`, password = session token |

sdkck today ships the OSS-broker SDK (`src/agent-vault/`) and command-wide interception (`setup-agent-vault` hook re-executes every invocation with proxy env — Node reads `NODE_USE_ENV_PROXY`/`NODE_EXTRA_CA_CERTS` at startup, so re-exec is the only way to cover in-process `fetch`). The actual usage this design serves is the platform product.

The platform's `infisical agent-vault run` does exactly three things: fetch the proxy CA, set the CA-trust + `HTTPS_PROXY`/`HTTP_PROXY` env (token embedded as userinfo), and spawn the agent. This design builds the equivalent natively into sdkck's existing interception machinery so no infisical CLI is needed on agent machines.

**Platform session lifecycle note:** sessions are created in the dashboard (token shown once) or via the infisical CLI; there is no documented REST API for creating/revoking them. sdkck consumes a pre-issued `agv_` token; lifecycle stays with the dashboard/infisical CLI.

## 2. Decisions made

1. **Deliverable:** hook + SDK (not a standalone `sdkck agent-vault run` command, not config-only wiring).
2. **Coexistence:** keep the OSS-broker SDK; auto-detect the backend from which config fields are set. No token-prefix sniffing — tokens stay opaque.
3. **Approach:** backend abstraction in the process layer; the platform client reuses the existing `ContainerConfig` → `writeCaCertificate` → `buildProxyEnv` → `mergeNoProxy` → `applyProxyEnv` pipeline. The env-assembly tail of `interceptRequests` is extracted into a shared helper so the sync-sensitive part has exactly one implementation.

## 3. Architecture

One interception pipeline, two backends. The process layer resolves *which* backend is configured; both produce the same `ContainerConfig` shape and share everything downstream.

```
hook (init) ──> shouldIntercept(env, fileConfig) ──> InterceptTarget
                      │                                │
                      │   {kind:'broker', vault}       │  {kind:'platform', sessionToken, proxy, caFingerprint?}
                      ▼                                ▼
             AgentVault.vault(v).intercept()    PlatformProxy.intercept()   ← new, src/agent-vault/platform.ts
                      └────────────┬───────────────────┘
                                   ▼
        shared: assemble cert + env (writeCaCertificate → buildProxyEnv → mergeNoProxy → applyProxyEnv)
                                   ▼
                     re-exec child (unchanged machinery), exit code passthrough
```

## 4. Config surface and auto-detection

New environment variables, each falling back to a new `agent-vault.json` field (env > file, matching the existing per-field pattern):

| env var | file field | meaning |
| --- | --- | --- |
| `AGENT_VAULT_SESSION_TOKEN` | `sessionToken` | the `agv_…` session token issued by the dashboard |
| `AGENT_VAULT_PROXY` | `proxy` | proxy address: `host:17323` or a full `http://` URL |
| `AGENT_VAULT_CA_FINGERPRINT` | `caFingerprint` | optional SHA-256 pin of the proxy CA (`SHA256:<hex>` or bare hex) |

`AGENT_VAULT_NO_PROXY` / file `noProxy` are unchanged and shared by both backends.

### Detection rules (`shouldIntercept`)

1. `SDKCK_AGENT_VAULT_ACTIVE` (sentinel) or `SDKCK_AGENT_VAULT_DISABLED=1` → skip, before any config is read (unchanged).
2. **Any** platform field set (`sessionToken` or `proxy`, from env or file) ⇒ platform mode is intended; both fields are required — exactly one set throws `AgentVaultError` naming the missing field. `caFingerprint` is optional and never sufficient on its own.
3. Otherwise the broker pair behaves exactly as today: `token` + `vault` both set → intercept; a lone field → silent skip (existing semantics, deliberately unchanged).
4. Both backends fully configured → **platform takes precedence** (documented resolution order, same spirit as env-over-file). Not an error: it makes incremental migration of `agent-vault.json` frictionless.

The token is not validated for shape (`agv_` prefix or otherwise): upstream owns the format, and detection keys on fields, not prefixes.

## 5. Platform client — `src/agent-vault/platform.ts`

```typescript
const proxy = new PlatformProxy({proxy: 'proxy.internal:17323', sessionToken: 'agv_…'})
const {certPath, containerConfig, env, mode} = await proxy.intercept({env: {}, noProxy: 'internal.corp'})
// mode is always 'platform'
```

- **Types:** `PlatformProxyConfig` (`proxy`, `sessionToken`, `caFingerprint?`), `PlatformInterceptResult` (`certPath`, `containerConfig`, `env`, `mode: 'platform'`). Exported from `src/agent-vault/index.ts` and `src/index.ts` (the package doubles as a library).
- **Address normalization:** trim; bare `host:port` gets `http://` prepended; input that still fails `new URL()` parsing throws `AgentVaultError`.
- **CA fetch:** `GET http://<proxy>/_agent-vault/ca` → JSON envelope, certificate read from `.certificate`. Implemented with `node:http` directly — **not** `fetch` — so an ambient proxy env in the surrounding shell can never hijack the bootstrap fetch. Non-2xx → `ApiError` (status/code); malformed JSON or a missing/non-string `certificate` field → `AgentVaultError`; a timeout applies, mirroring `http.ts` conventions.
- **CA pinning:** when `caFingerprint` is configured, compute SHA-256 over the certificate's DER (base64-decoded PEM body), normalize both sides (optional `SHA256:` prefix, case-insensitive), and abort before any env is applied on mismatch — mirroring the infisical CLI's `--ca-fingerprint`.
- **Route built:**
  - `HTTPS_PROXY` = `HTTP_PROXY` = `http://x-agent-vault:<percent-encoded-token>@<host>:<port>` (the token travels to the proxy per-request; percent-encode even though `agv_` tokens are URL-safe today).
  - `NO_PROXY` base = `localhost,127.0.0.1,<proxy-host>`, then the shared merge layers inherited `NO_PROXY`/`no_proxy` (both spellings) plus the `noProxy` option on top. The existing `AGENT_VAULT_NO_PROXY` escape hatch therefore works unchanged — required for internal destinations, which the platform proxy 403s under strict traffic policy just as the broker 502s private IPs.
- **Shared env assembly:** the tail of `interceptRequests` (cert write → `buildProxyEnv` → `NO_PROXY` merge → `applyProxyEnv`) moves into an exported helper in `proxy.ts` (e.g. `assembleInterceptedEnv(containerConfig, {certPath?, env?, noProxy?})`), called by both backends. `buildProxyEnv` output (incl. `NODE_USE_ENV_PROXY=1`, `OPENCLAW_PROXY_URL`, and the CA trust vars for Node/Python/curl/Git/Deno) is reused verbatim.

## 6. Process layer and hook

- `shouldIntercept(env, fileConfig)` returns `InterceptTarget | undefined` — a discriminated union `{kind: 'broker', vault} | {kind: 'platform', sessionToken, proxy, caFingerprint?}` — instead of a bare vault name; throws `AgentVaultError` on incomplete platform config.
- `runIntercepted(options)` receives the resolved `target` and branches: the broker path is unchanged (including the `agentVault` DI seam); the platform path constructs a `PlatformProxy` (injectable via `platformProxy?` for tests) and calls `intercept()`. Spawn/signal/exit-code machinery untouched.
- **Child env hygiene:** `AGENT_VAULT_SESSION_TOKEN`, `AGENT_VAULT_PROXY`, and `AGENT_VAULT_CA_FINGERPRINT` are deleted from the child's environment — the credential rides inside the proxy URL and the `SDKCK_AGENT_VAULT_ACTIVE` sentinel prevents re-interception. `AGENT_VAULT_NO_PROXY` is not secret and stays.
- **Hook:** target resolution moves inside the existing try block, so detection/resolution errors get the same fail-closed treatment (`this.error` with the `SDKCK_AGENT_VAULT_DISABLED=1` hint, exit 1). Error messages name the backend: `vault "<name>"` for broker, `session through <proxy>` for platform.

## 7. Error handling

Fails closed, matching the broker path: CA fetch failure, fingerprint mismatch, or incomplete config → the command never runs unbrokered (exit 1 with the disable hint).

There is **no pre-validation endpoint** on the platform proxy, so a dead session cannot be detected at startup; it surfaces at request time from the child's traffic: `403` = session expired/revoked or blocked by policy, `407` = session token missing (a bug — the client always embeds it), `502`/`503` = proxy cannot reach Infisical or its access was revoked. This mapping goes into the documentation's troubleshooting notes.

## 8. Testing

TDD throughout; all existing broker tests must keep passing untouched.

- **New `test/agent-vault/platform.test.ts`** — mock `node:http` server: happy-path envelope, non-2xx → `ApiError`, malformed JSON, missing/non-string `.certificate`; address normalization (`host:port`, full URL, invalid); env building (token percent-encoding, both PROXY vars, `NODE_USE_ENV_PROXY=1`, CA vars at `certPath`, `NO_PROXY` contents incl. the proxy host); `noProxy` merging (option + inherited env, both spellings); fingerprint pin (accepts `SHA256:`-prefixed/bare/lowercase hex, mismatch throws and applies nothing).
- **`test/agent-vault/config-file.test.ts`** — new fields `sessionToken`/`proxy`/`caFingerprint` round-trip; non-string values throw; the malformed-file error message lists the expanded field set.
- **`test/agent-vault-process.test.ts`** — detection matrix: nothing → skip; sentinel/disable → skip; broker pair via env/file/mixed precedence; platform pair; platform-over-broker precedence; lone platform field → throws naming the missing one. `runIntercepted` platform path with a fake `spawnFn`: child env has the sentinel, no platform vars, `HTTPS_PROXY` with userinfo + host, CA vars pointing at the written cert; exit code passthrough; cert dir cleaned up.
- **`test/hooks/init/setup-agent-vault.test.ts`** — platform env triggers the platform branch (via `platformProxy` DI); resolution failure → fail-closed message including the disable hint; broker branch regression-covered by existing cases.

## 9. Documentation

- `CLAUDE.md` — Agent Vault section (two backends, detection rules) and Environment section (new vars).
- `README.md` — Credential Brokering section: platform subsection with a dashboard-token + proxy example next to the existing broker example.
- `docs/` (Next.js docs site) — the Agent Vault page gets the platform backend documented.

## 10. Live verification (after implementation)

Against the user's real proxy (needs from the user at that point: the proxy host, a fresh session token, and which services the access bundle covers — or a dashboard look):

1. `AGENT_VAULT_SESSION_TOKEN` + `AGENT_VAULT_PROXY` set → a command hitting a bundled service host returns authenticated (credential injected in flight); the identical call with `SDKCK_AGENT_VAULT_DISABLED=1` fails unauthenticated.
2. A deliberately wrong `caFingerprint` aborts before the command runs.
3. `AGENT_VAULT_NO_PROXY` excludes an internal host and it goes out direct.

## 11. Out of scope

- **macOS keychain trust:** env vars cover Node/Python/curl/Git/Deno; Go binaries (e.g. `gh`) read the system store and need the CA installed there — documented limitation, not implemented.
- **Session create/list/revoke APIs:** undocumented; the dashboard / infisical CLI owns the lifecycle.
- **Proxy enrollment, auto-renewal, `sdkck agent-vault run` command.**
