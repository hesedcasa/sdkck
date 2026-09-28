# Infisical Platform Agent Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every `sdkck <command>` run brokered through the Infisical SaaS platform Agent Vault proxy (session token + enrolled proxy), coexisting with the existing self-hosted OSS-broker support via auto-detection — no wrapper command, no infisical CLI.

**Architecture:** `shouldIntercept` returns a discriminated `InterceptTarget` (`broker` | `platform`) instead of a bare vault name. A new `PlatformProxy` client (`src/agent-vault/platform.ts`) fetches the proxy CA from `GET /_agent-vault/ca` via `node:http`, verifies an optional SHA-256 pin, and produces the same `ContainerConfig` the broker client produces — so the shared tail (`writeCaCertificate` → `buildProxyEnv` → `NO_PROXY` merge → `applyProxyEnv`, extracted as `assembleInterceptedEnv`) is reused verbatim. `runIntercepted` branches on the target; the re-exec spawn machinery is untouched.

**Tech Stack:** TypeScript (strict, ESM, ES2022, `module: Node16`), oclif v5 hooks, mocha + chai, `node:http`/`node:https`/`node:crypto`. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-09-28-infisical-platform-agent-vault-design.md` — read it first; this plan argues from it.

## Global Constraints

- **No new npm dependencies.** The platform CA fetch uses `node:http`/`node:https` and `node:crypto` only.
- **Fails closed:** CA fetch failure, fingerprint mismatch, or incomplete platform config → the command never runs unbrokered. `SDKCK_AGENT_VAULT_DISABLED=1` remains the per-invocation escape hatch.
- **Tokens are opaque.** No `agv_`/`av_` prefix sniffing anywhere; backend detection keys only on which config fields are set.
- **Userinfo is percent-encoded:** `encodeURIComponent(sessionToken)` inside the proxy URL, even though `agv_` tokens are URL-safe today.
- **One env-construction implementation:** all proxy/CA env building flows through the shared `assembleInterceptedEnv` (Task 2). Do not fork `buildProxyEnv`'s variable set.
- **Certificate writes go through `writeCaCertificate`** (O_EXCL, never follows links) — never a direct `fs.writeFile`.
- **Broker behavior is unchanged.** Existing broker tests may only receive *mechanical* call-site updates (the `vault: '…'` option becomes `target: {kind: 'broker', vault: '…'}`); no behavioral assertion may change.
- **Verification commands:** single test file `npx mocha --forbid-only "test/<path>.test.ts"`; whole suite `npm test`; lint `npm run lint`; build `npm run build`.
- **Commits** follow Conventional Commits (`feat(agent-vault): …`, `test(agent-vault): …`, `docs(agent-vault): …`).
- Node ≥ 22, ESM (`"type": "module"`), prettier + eslint-config-oclif apply to all files.

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `src/agent-vault/config-file.ts` | Modify | Adds `sessionToken`, `proxy`, `caFingerprint` fields to `agent-vault.json` parsing |
| `src/agent-vault/proxy.ts` | Modify | Extracts the shared env-assembly tail into `assembleInterceptedEnv` |
| `src/agent-vault/platform.ts` | Create | Platform backend: address normalization, CA fetch, pinning, `PlatformProxy.intercept()` |
| `src/agent-vault/index.ts` | Modify | Exports the new platform symbols |
| `src/agent-vault-process.ts` | Modify | `InterceptTarget`, backend detection in `shouldIntercept`, platform branch in `runIntercepted` |
| `src/hooks/init/setup-agent-vault.ts` | Modify | Resolution inside try, backend-aware fail-closed message |
| `src/index.ts` | None | Already `export * from './agent-vault/index.js'` (line 1) |
| `test/agent-vault/config-file.test.ts` | Modify | New-field round-trips |
| `test/agent-vault/proxy.test.ts` | Modify | One new `assembleInterceptedEnv` test; everything else untouched |
| `test/agent-vault/platform.test.ts` | Create | Platform primitives + `PlatformProxy` |
| `test/agent-vault-process.test.ts` | Modify | `target` option shape; platform detection + platform `runIntercepted` tests |
| `test/hooks/init/setup-agent-vault.test.ts` | Modify | Platform env keys; platform fail-closed tests |
| `CLAUDE.md`, `README.md`, `docs/src/app/agent-vault/page.mdx` | Modify | Documentation |

---

### Task 1: Platform fields in `agent-vault.json`

**Files:**
- Modify: `src/agent-vault/config-file.ts`
- Test: `test/agent-vault/config-file.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `AgentVaultFileConfig` gains optional string fields `sessionToken`, `proxy`, `caFingerprint` (Tasks 5 and 6 read them); malformed-file error message lists all seven fields.

- [ ] **Step 1: Write the failing tests**

In `test/agent-vault/config-file.test.ts`, inside `describe('readAgentVaultFileConfig')`, after the existing `reads noProxy from the file` test, add:

```typescript
    it('reads the platform fields from the file', async () => {
      await writeFile(
        join(tmpDir, 'agent-vault.json'),
        JSON.stringify({
          caFingerprint: 'SHA256:ABCD',
          proxy: 'proxy.internal:17323',
          sessionToken: 'agv_file',
        }),
        'utf8',
      )

      expect(readAgentVaultFileConfig(tmpDir)).to.deep.equal({
        caFingerprint: 'SHA256:ABCD',
        proxy: 'proxy.internal:17323',
        sessionToken: 'agv_file',
      })
    })

    it('throws when a platform field is not a string', async () => {
      await writeFile(join(tmpDir, 'agent-vault.json'), JSON.stringify({proxy: 17323}), 'utf8')

      expect(() => readAgentVaultFileConfig(tmpDir)).to.throw(AgentVaultError, /"proxy" must be a string/)
    })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx mocha --forbid-only "test/agent-vault/config-file.test.ts"`
Expected: FAIL — the platform-fields test sees `undefined` keys in the result (deep-equal mismatch), and the non-string `proxy` is silently ignored rather than throwing.

- [ ] **Step 3: Implement**

In `src/agent-vault/config-file.ts`:

Replace the `AgentVaultFileConfig` type with:

```typescript
/** Config-file fallback for the Agent Vault environment variables. */
export type AgentVaultFileConfig = {
  address?: string
  /** Optional SHA-256 pin of the platform proxy CA, fallback for `AGENT_VAULT_CA_FINGERPRINT`. */
  caFingerprint?: string
  /**
   * Comma-separated hosts to bypass the proxy for, fallback for
   * `AGENT_VAULT_NO_PROXY`. Merged into `NO_PROXY` alongside the backend's own
   * entries (`localhost`, `127.0.0.1`, its host).
   */
  noProxy?: string
  /** Infisical platform Agent Vault proxy address, fallback for `AGENT_VAULT_PROXY`. */
  proxy?: string
  /** Infisical platform Agent Vault session token (`agv_...`), fallback for `AGENT_VAULT_SESSION_TOKEN`. */
  sessionToken?: string
  token?: string
  vault?: string
}
```

In `readAgentVaultFileConfig`, replace the malformed-object error message and the destructuring/loop:

```typescript
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new AgentVaultError(
      `${path} must contain a JSON object with optional "token", "address", "vault", "noProxy", "sessionToken", "proxy", "caFingerprint" fields.`,
    )
  }

  const {address, caFingerprint, noProxy, proxy, sessionToken, token, vault} = parsed as Record<string, unknown>
  const result: AgentVaultFileConfig = {}
  for (const [key, value] of Object.entries({address, caFingerprint, noProxy, proxy, sessionToken, token, vault})) {
    if (value === undefined) continue
    if (typeof value !== 'string') {
      throw new AgentVaultError(`${path}: "${key}" must be a string.`)
    }

    result[key as keyof AgentVaultFileConfig] = value
  }

  return result
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx mocha --forbid-only "test/agent-vault/config-file.test.ts"`
Expected: PASS (all pre-existing cases included).

- [ ] **Step 5: Commit**

```bash
git add src/agent-vault/config-file.ts test/agent-vault/config-file.test.ts
git commit -m "feat(agent-vault): accept platform session/proxy/fingerprint fields in agent-vault.json"
```

---

### Task 2: Extract the shared env-assembly tail (`assembleInterceptedEnv`)

**Files:**
- Modify: `src/agent-vault/proxy.ts`
- Modify: `src/agent-vault/index.ts` (export)
- Test: `test/agent-vault/proxy.test.ts`

**Interfaces:**
- Consumes: `writeCaCertificate`, `defaultCertPath`, `buildProxyEnv`, `mergeNoProxy`, `applyProxyEnv` — all already in `proxy.ts`.
- Produces: `assembleInterceptedEnv(containerConfig: ContainerConfig, options?: AssembleEnvOptions): Promise<{certPath: string; env: Record<string, string>}>` and `type AssembleEnvOptions = {certPath?: string; env?: NodeJS.ProcessEnv; noProxy?: string; skipCertWrite?: boolean}`. Task 4 calls this; Task 2's refactor must leave every existing `proxy.test.ts` assertion passing unchanged.

- [ ] **Step 1: Write the failing test**

In `test/agent-vault/proxy.test.ts`, add `assembleInterceptedEnv` to the existing import from `'../../src/agent-vault/index.js'`, then add this suite inside the top-level `describe` (sibling of `describe('writeCaCertificate')`):

```typescript
  describe('assembleInterceptedEnv', () => {
    it('writes the certificate and applies the proxy env to the passed object', async () => {
      const target: NodeJS.ProcessEnv = {}
      const certPath = join(tmpDir, 'assembled', 'ca.pem')

      const {certPath: written, env} = await assembleInterceptedEnv(
        {
          caCertificate: CA_PEM,
          env: {
            HTTP_PROXY: 'http://tok:vault@proxy.internal:14322',
            HTTPS_PROXY: 'http://tok:vault@proxy.internal:14322',
            NO_PROXY: 'localhost,127.0.0.1,proxy.internal',
          },
        },
        {certPath, env: target},
      )

      expect(written).to.equal(certPath)
      expect(await readFile(certPath, 'utf8')).to.equal(CA_PEM)
      expect(env.HTTPS_PROXY).to.equal('http://tok:vault@proxy.internal:14322')
      expect(env.NODE_USE_ENV_PROXY).to.equal('1')
      expect(env.NODE_EXTRA_CA_CERTS).to.equal(certPath)
      expect(target).to.equal(env)
    })
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx mocha --forbid-only "test/agent-vault/proxy.test.ts"`
Expected: FAIL — `assembleInterceptedEnv` does not exist (the new suite errors; every pre-existing case still passes).

- [ ] **Step 3: Implement**

In `src/agent-vault/proxy.ts`, insert after the `InterceptResult` type definition:

```typescript
/** Options shared by every path that assembles an intercepted environment. */
export type AssembleEnvOptions = {
  /**
   * Where to write the root CA certificate. Defaults to a file in a private
   * directory created for this process ({@link defaultCertPath}).
   */
  certPath?: string
  /**
   * Environment object to mutate. Defaults to `process.env`. Pass a plain
   * object to build an env for a child process without touching this one.
   */
  env?: NodeJS.ProcessEnv
  /** Extra comma-separated hosts to add to `NO_PROXY`, on top of the inherited ones. */
  noProxy?: string
  /** Skip writing the CA certificate — set when it is already on disk at `certPath`. */
  skipCertWrite?: boolean
}

/**
 * Write the root CA certificate and apply the proxy plus CA-trust variables to
 * a target environment — the tail every credential backend shares, so the
 * sync-sensitive env construction (`buildProxyEnv`'s variable set) has exactly
 * one implementation.
 */
export async function assembleInterceptedEnv(
  containerConfig: ContainerConfig,
  options?: AssembleEnvOptions,
): Promise<{certPath: string; env: Record<string, string>}> {
  const certPath = options?.certPath ?? (await defaultCertPath())
  if (!options?.skipCertWrite) {
    await writeCaCertificate(containerConfig, certPath)
  }

  const targetEnv = options?.env ?? process.env
  const env = buildProxyEnv(containerConfig, certPath)
  // Preserve whatever the target environment already had bypassed — otherwise
  // interception silently pulls previously-direct destinations onto the
  // proxy, which is exactly the failure mode `noProxy` exists to prevent. Both
  // spellings: `applyProxyEnv` installs uppercase `NO_PROXY` and drops other
  // case variants, so a caller supplying only the POSIX-lowercase `no_proxy`
  // would otherwise have it silently cleared rather than merged in.
  let noProxy = mergeNoProxy(env.NO_PROXY, targetEnv.NO_PROXY)
  noProxy = mergeNoProxy(noProxy, targetEnv.no_proxy)
  env.NO_PROXY = mergeNoProxy(noProxy, options?.noProxy)
  applyProxyEnv(env, targetEnv)

  return {certPath, env}
}
```

Then replace the body of `interceptRequests` (everything after `resolveRoute`) with the call:

```typescript
export async function interceptRequests(vault: VaultClient, options?: InterceptOptions): Promise<InterceptResult> {
  const {containerConfig, mode, session} = await resolveRoute(vault, options)

  const {certPath, env} = await assembleInterceptedEnv(containerConfig, options)

  return {certPath, containerConfig, env, mode, session}
}
```

(`InterceptOptions` already structurally satisfies `AssembleEnvOptions`; keep its `mode`/`ttlSeconds` fields as they are.)

In `src/agent-vault/index.ts`, extend the interception export block:

```typescript
// Request interception — routes traffic through the proxy that injects credentials
export {applyProxyEnv, assembleInterceptedEnv, defaultCertPath, interceptRequests, writeCaCertificate} from './proxy.js'

export type {AssembleEnvOptions, InterceptMode, InterceptOptions, InterceptResult} from './proxy.js'
```

- [ ] **Step 4: Run the full agent-vault suite to verify the refactor is behavior-preserving**

Run: `npx mocha --forbid-only "test/agent-vault/*.test.ts"`
Expected: PASS — the new `assembleInterceptedEnv` suite and every pre-existing case (including `interceptRequests` integration tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent-vault/proxy.ts src/agent-vault/index.ts test/agent-vault/proxy.test.ts
git commit -m "refactor(agent-vault): extract the shared intercept env assembly into assembleInterceptedEnv"
```

---

### Task 3: Platform primitives — address normalization, CA fetch, fingerprint pinning

**Files:**
- Create: `src/agent-vault/platform.ts`
- Modify: `src/agent-vault/index.ts` (exports)
- Test: `test/agent-vault/platform.test.ts`

**Interfaces:**
- Consumes: `AgentVaultError`, `ApiError` from `./errors.js`.
- Produces (used by Task 4 and the tests):
  - `normalizeProxyAddress(input: string): URL` — trims, prepends `http://` when no `://`, throws `AgentVaultError` on unparseable input, empty host, or a non-http(s) scheme.
  - `fetchProxyCa(address: URL, timeoutMs?: number): Promise<string>` — `GET <address>/_agent-vault/ca` via `node:http`/`node:https`; resolves the `.certificate` string; throws `ApiError` on non-2xx, `AgentVaultError` on malformed JSON, missing/non-string `certificate`, timeout, or network error. Default timeout 30 000 ms.
  - `certificateFingerprint(pem: string): string` — uppercase-hex SHA-256 of the DER body; throws `AgentVaultError` on non-PEM input.
  - `normalizeFingerprint(value: string): string` — strips an optional `sha256:` prefix (case-insensitive), trims, uppercases.

- [ ] **Step 1: Write the failing tests**

Create `test/agent-vault/platform.test.ts`:

```typescript
import {expect} from 'chai'
import {createServer, type Server} from 'node:http'
import {createHash} from 'node:crypto'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {type AddressInfo} from 'node:net'
import {join} from 'node:path'

import {
  buildPlatformContainerConfig,
  certificateFingerprint,
  fetchProxyCa,
  normalizeFingerprint,
  normalizeProxyAddress,
  PlatformProxy,
} from '../../src/agent-vault/index.js'
import {AgentVaultError, ApiError} from '../../src/agent-vault/errors.js'

const CA_PEM = '-----BEGIN CERTIFICATE-----\nstub\n-----END CERTIFICATE-----\n'

/** Start a stub platform proxy; its CA endpoint answers with `body` and `status`. */
async function startCaStub(options?: {body?: string; status?: number; hang?: boolean}): Promise<{server: Server; url: URL}> {
  const server = createServer((_request, response) => {
    if (options?.hang) return // never respond — the client must time out

    response.writeHead(options?.status ?? 200, {'Content-Type': 'application/json'})
    response.end(options?.body ?? JSON.stringify({certificate: CA_PEM}))
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const {port} = server.address() as AddressInfo
  return {server, url: new URL(`http://127.0.0.1:${port}`)}
}

function stopStub(server: Server): Promise<void> {
  server.closeAllConnections()
  return new Promise((resolve) => server.close(() => resolve()))
}

describe('agent-vault platform primitives', () => {
  describe('normalizeProxyAddress', () => {
    it('defaults the scheme to http for bare host:port input', () => {
      const url = normalizeProxyAddress('proxy.internal:17323')
      expect(url.protocol).to.equal('http:')
      expect(url.hostname).to.equal('proxy.internal')
      expect(url.port).to.equal('17323')
    })

    it('keeps an explicit scheme and trims whitespace', () => {
      expect(normalizeProxyAddress('  https://proxy.internal  ').protocol).to.equal('https:')
    })

    it('throws on garbage, empty hosts, and non-http schemes', () => {
      expect(() => normalizeProxyAddress('not a url!!')).to.throw(AgentVaultError)
      expect(() => normalizeProxyAddress('http://')).to.throw(AgentVaultError, /host is missing/)
      expect(() => normalizeProxyAddress('ftp://proxy.internal:17323')).to.throw(AgentVaultError, /http and https/)
    })
  })

  describe('fetchProxyCa', () => {
    let stub: {server: Server; url: URL} | undefined

    afterEach(async () => {
      if (stub) await stopStub(stub.server)
      stub = undefined
    })

    it('fetches the certificate from /_agent-vault/ca', async () => {
      stub = await startCaStub()

      const ca = await fetchProxyCa(stub.url)
      expect(ca).to.equal(CA_PEM)
    })

    it('maps a non-2xx answer to an ApiError carrying the status', async () => {
      stub = await startCaStub({body: 'nope', status: 404})

      const error = await fetchProxyCa(stub.url).catch((error_: unknown) => error_)
      expect(error).to.be.instanceOf(ApiError)
      expect((error as ApiError).status).to.equal(404)
    })

    it('rejects a body that is not valid JSON', async () => {
      stub = await startCaStub({body: '<html>gateway error</html>'})

      const error = await fetchProxyCa(stub.url).catch((error_: unknown) => error_)
      expect(error).to.be.instanceOf(AgentVaultError)
      expect((error as Error).message).to.match(/valid JSON/)
    })

    it('rejects an envelope without a string certificate field', async () => {
      stub = await startCaStub({body: JSON.stringify({certificate: 42})})

      const error = await fetchProxyCa(stub.url).catch((error_: unknown) => error_)
      expect(error).to.be.instanceOf(AgentVaultError)
      expect((error as Error).message).to.match(/"certificate"/)
    })

    it('times out when the proxy never answers', async () => {
      stub = await startCaStub({hang: true})

      const error = await fetchProxyCa(stub.url, 50).catch((error_: unknown) => error_)
      expect(error).to.be.instanceOf(AgentVaultError)
      expect((error as Error).message).to.match(/timed out after 50ms/)
    })

    it('rejects with a network error when nothing listens on the port', async () => {
      const dead = await startCaStub()
      await stopStub(dead.server)

      const error = await fetchProxyCa(dead.url, 2_000).catch((error_: unknown) => error_)
      expect(error).to.be.instanceOf(AgentVaultError)
      expect((error as Error).message).to.match(/Network error/)
    })
  })

  describe('certificate fingerprints', () => {
    it('hashes the PEM body to an uppercase-hex SHA-256 of the DER', () => {
      const der = Buffer.from('stub'.replace(/\s+/g, ''), 'base64')
      const expected = createHash('sha256').update(der).digest('hex').toUpperCase()

      expect(certificateFingerprint(CA_PEM)).to.equal(expected)
    })

    it('rejects non-PEM input', () => {
      expect(() => certificateFingerprint('definitely not a certificate')).to.throw(AgentVaultError)
    })

    it('normalizes the optional sha256 prefix and case away', () => {
      expect(normalizeFingerprint('sha256:ab cd')).to.equal('ABCD')
      expect(normalizeFingerprint('ABCD')).to.equal('ABCD')
    })
  })
})
```

(Only this plain-await form is used — `chai-as-promised` exists in devDependencies but is not registered in `.mocharc.json`, so all async assertions follow the `.catch((error_) => error_)` pattern shown in the other tests.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx mocha --forbid-only "test/agent-vault/platform.test.ts"`
Expected: FAIL — the module `../../src/agent-vault/index.js` has no such exports (import-time failure).

- [ ] **Step 3: Implement**

Create `src/agent-vault/platform.ts`:

```typescript
import {createHash} from 'node:crypto'
import {request as httpRequest, type RequestOptions} from 'node:http'
import {request as httpsRequest} from 'node:https'

import {AgentVaultError, ApiError} from './errors.js'

/** Path on the platform proxy that serves its root CA certificate. */
const CA_PATH = '/_agent-vault/ca'
/** Default CA-fetch timeout, matching the HttpClient convention (30s). */
const DEFAULT_CA_TIMEOUT_MS = 30_000

/**
 * Parse a proxy address, defaulting the scheme to `http://` — the bare
 * `host:17323` form `infisical agent-vault run --proxy` accepts.
 *
 * @throws {AgentVaultError} on unparseable input, a missing host, or a
 *   scheme other than http/https.
 */
export function normalizeProxyAddress(input: string): URL {
  const trimmed = input.trim()
  const candidate = trimmed.includes('://') ? trimmed : `http://${trimmed}`

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new AgentVaultError(`"${input}" is not a valid Agent Vault proxy address.`)
  }

  if (!url.hostname) {
    throw new AgentVaultError(`"${input}" is not a valid Agent Vault proxy address: the host is missing.`)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AgentVaultError(
      `"${input}" is not a valid Agent Vault proxy address: only http and https proxies are supported.`,
    )
  }

  return url
}

/** Extract the certificate string from the `{"certificate": "..."}` envelope. */
function parseCaResponse(body: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new AgentVaultError(`The Agent Vault proxy did not return valid JSON from ${CA_PATH}.`)
  }

  const certificate =
    typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>).certificate : undefined
  if (typeof certificate !== 'string' || certificate.length === 0) {
    throw new AgentVaultError(`The Agent Vault proxy response from ${CA_PATH} has no "certificate" field.`)
  }

  return certificate
}

/**
 * Fetch the platform proxy's root CA from `GET /_agent-vault/ca`.
 *
 * Uses `node:http`/`node:https` rather than `fetch` on purpose: this is a
 * bootstrap request that must reach the proxy directly, while an ambient
 * proxy environment in the surrounding shell (`NODE_USE_ENV_PROXY` plus
 * `HTTPS_PROXY`) would hijack a `fetch` and route the bootstrap through the
 * very proxy whose CA is still being fetched.
 *
 * @throws {ApiError} on a non-2xx answer. @throws {AgentVaultError} on
 *   malformed JSON, a missing "certificate" field, a timeout, or a network error.
 */
export async function fetchProxyCa(address: URL, timeoutMs = DEFAULT_CA_TIMEOUT_MS): Promise<string> {
  const url = new URL(CA_PATH, address)

  return new Promise<string>((resolve, reject) => {
    const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest
    let settled = false
    let isTimedOut = false

    const request = requestFn(url, {method: 'GET'} as RequestOptions, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      response.on('end', () => {
        settled = true
        clearTimeout(timeoutId)

        const status = response.statusCode ?? 0
        if (status !== 200) {
          reject(
            new ApiError({
              code: 'unknown',
              headers: new Headers(),
              message: `Fetching the Agent Vault proxy CA from ${CA_PATH} failed with status ${status}.`,
              status,
            }),
          )
          return
        }

        try {
          resolve(parseCaResponse(Buffer.concat(chunks).toString('utf8')))
        } catch (error) {
          reject(error)
        }
      })
    })

    const timeoutId = setTimeout(() => {
      isTimedOut = true
      request.destroy()
    }, timeoutMs)

    request.on('error', (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)

      if (isTimedOut) {
        reject(new AgentVaultError(`Request timed out after ${timeoutMs}ms: GET ${CA_PATH}`))
      } else {
        reject(new AgentVaultError(`Network error contacting the Agent Vault proxy: ${error.message}`))
      }
    })

    request.end()
  })
}

/**
 * SHA-256 fingerprint (uppercase hex) of a PEM certificate's DER body — the
 * form the dashboard displays and `--ca-fingerprint` accepts, modulo the
 * optional `SHA256:` prefix that {@link normalizeFingerprint} strips.
 *
 * @throws {AgentVaultError} when the input is not a PEM certificate.
 */
export function certificateFingerprint(pem: string): string {
  const body = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(pem)?.[1]
  if (!body) {
    throw new AgentVaultError('The Agent Vault proxy CA is not a PEM certificate, so it cannot be pinned.')
  }

  const der = Buffer.from(body.replace(/\s+/g, ''), 'base64')
  return createHash('sha256').update(der).digest('hex').toUpperCase()
}

/** Normalize a configured pin: optional `SHA256:` prefix off, trimmed, uppercase. */
export function normalizeFingerprint(value: string): string {
  return value.trim().replace(/^sha256:/i, '').toUpperCase()
}
```

In `src/agent-vault/index.ts`, add (after the MITM export block):

```typescript
// Platform proxy — the Infisical SaaS Agent Vault backend (session token + enrolled proxy)
export {
  certificateFingerprint,
  fetchProxyCa,
  normalizeFingerprint,
  normalizeProxyAddress,
} from './platform.js'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx mocha --forbid-only "test/agent-vault/platform.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent-vault/platform.ts src/agent-vault/index.ts test/agent-vault/platform.test.ts
git commit -m "feat(agent-vault): add platform proxy CA fetch, address normalization and CA pinning"
```

---

### Task 4: `PlatformProxy.intercept()` — the platform credential path

**Files:**
- Modify: `src/agent-vault/platform.ts`
- Modify: `src/agent-vault/index.ts` (exports)
- Test: `test/agent-vault/platform.test.ts`

**Interfaces:**
- Consumes: `assembleInterceptedEnv` + `AssembleEnvOptions` (Task 2), `fetchProxyCa`/`normalizeProxyAddress`/`certificateFingerprint`/`normalizeFingerprint` (Task 3), `ContainerConfig` from `./resources/mitm.js`, `buildProxyEnv` output unchanged.
- Produces (used by Tasks 5 and 6):
  - `type PlatformProxyConfig = {caFingerprint?: string; proxy: string; sessionToken: string}`
  - `type PlatformInterceptOptions = AssembleEnvOptions & {timeoutMs?: number}`
  - `type PlatformInterceptResult = {certPath: string; containerConfig: ContainerConfig; env: Record<string, string>; mode: 'platform'}`
  - `class PlatformProxy { constructor(config: PlatformProxyConfig); intercept(options?: PlatformInterceptOptions): Promise<PlatformInterceptResult> }`
  - `buildPlatformContainerConfig(address: URL, sessionToken: string, caCertificate: string): ContainerConfig` — proxy URL `<scheme>://x-agent-vault:<encodeURIComponent(token)>@<host[:port]>`, `NO_PROXY` = `localhost,127.0.0.1,<hostname>`.

- [ ] **Step 1: Write the failing tests**

In `test/agent-vault/platform.test.ts`, add to the import from `'../../src/agent-vault/index.js'`: `PlatformProxy`. Then append a new top-level `describe`:

```typescript
describe('PlatformProxy', () => {
  let tmpDir: string
  let stub: {server: Server; url: URL}

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-platform-proxy-'))
    stub = await startCaStub()
  })

  afterEach(async () => {
    await stopStub(stub.server)
    await rm(tmpDir, {force: true, recursive: true})
  })

  it('applies the platform proxy env to the passed object without touching process.env', async () => {
    const target: NodeJS.ProcessEnv = {}
    const before = {...process.env}

    const result = await new PlatformProxy({proxy: stub.url.origin, sessionToken: 'agv_tok'}).intercept({
      certPath: join(tmpDir, 'ca.pem'),
      env: target,
    })

    expect(result.mode).to.equal('platform')
    expect(result.env.HTTPS_PROXY).to.equal(`http://x-agent-vault:agv_tok@127.0.0.1:${stub.url.port}`)
    expect(result.env.HTTP_PROXY).to.equal(result.env.HTTPS_PROXY)
    expect(result.env.NODE_USE_ENV_PROXY).to.equal('1')
    expect(result.env.NO_PROXY).to.equal('localhost,127.0.0.1,127.0.0.1')
    expect(result.env.NODE_EXTRA_CA_CERTS).to.equal(join(tmpDir, 'ca.pem'))
    expect(target).to.equal(result.env)
    expect(process.env).to.deep.equal(before)
  })

  it('percent-encodes the session token in the proxy userinfo', async () => {
    const result = await new PlatformProxy({proxy: stub.url.origin, sessionToken: 'agv_a b/c'}).intercept({
      certPath: join(tmpDir, 'ca.pem'),
      env: {},
    })

    expect(result.env.HTTPS_PROXY).to.contain('x-agent-vault:agv_a%20b%2Fc@')
  })

  it('writes the fetched CA to the requested path', async () => {
    const result = await new PlatformProxy({proxy: stub.url.origin, sessionToken: 'agv_tok'}).intercept({
      certPath: join(tmpDir, 'ca.pem'),
      env: {},
    })

    expect(await readFile(result.certPath, 'utf8')).to.equal(CA_PEM)
    expect(result.containerConfig.caCertificate).to.equal(CA_PEM)
  })

  it('merges the noProxy option and inherited bypasses into NO_PROXY', async () => {
    const result = await new PlatformProxy({proxy: stub.url.origin, sessionToken: 'agv_tok'}).intercept({
      certPath: join(tmpDir, 'ca.pem'),
      env: {NO_PROXY: 'parent.internal', no_proxy: 'lower.internal'} as NodeJS.ProcessEnv,
      noProxy: 'config.internal',
    })

    expect(result.env.NO_PROXY).to.equal(
      'localhost,127.0.0.1,127.0.0.1,parent.internal,lower.internal,config.internal',
    )
  })

  it('accepts a matching CA fingerprint pin in any spelling', async () => {
    const pin = `sha256:${certificateFingerprint(CA_PEM).toLowerCase()}`

    const result = await new PlatformProxy({
      caFingerprint: pin,
      proxy: stub.url.origin,
      sessionToken: 'agv_tok',
    }).intercept({certPath: join(tmpDir, 'ca.pem'), env: {}})

    expect(result.mode).to.equal('platform')
  })

  it('fails closed on a fingerprint mismatch, before any env is applied', async () => {
    const target: NodeJS.ProcessEnv = {}
    const certPath = join(tmpDir, 'never-written.pem')

    const error = await new PlatformProxy({
      caFingerprint: 'sha256:deadbeef',
      proxy: stub.url.origin,
      sessionToken: 'agv_tok',
    })
      .intercept({certPath, env: target})
      .catch((error_: unknown) => error_)

    expect(error).to.be.instanceOf(AgentVaultError)
    expect((error as Error).message).to.match(/fingerprint/i)
    expect(target).to.deep.equal({})
  })

  it('exposes the parsed proxy through buildPlatformContainerConfig', () => {
    const config = buildPlatformContainerConfig(
      normalizeProxyAddress('proxy.internal:17323'),
      'agv_tok',
      CA_PEM,
    )

    expect(config.env.HTTPS_PROXY).to.equal('http://x-agent-vault:agv_tok@proxy.internal:17323')
    expect(config.env.NO_PROXY).to.equal('localhost,127.0.0.1,proxy.internal')
    expect(config.caCertificate).to.equal(CA_PEM)
  })
})
```

Add `buildPlatformContainerConfig` to the index import as well.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx mocha --forbid-only "test/agent-vault/platform.test.ts"`
Expected: FAIL — `PlatformProxy` / `buildPlatformContainerConfig` are not exported.

- [ ] **Step 3: Implement**

Append to `src/agent-vault/platform.ts` (after the primitives from Task 3):

```typescript
/** Options for {@link PlatformProxy.intercept}. */
export type PlatformInterceptOptions = AssembleEnvOptions & {
  /** CA fetch timeout in milliseconds. Default: 30000. */
  timeoutMs?: number
}

/** What {@link PlatformProxy.intercept} configured. */
export type PlatformInterceptResult = {
  /** Path the root CA certificate was written to. */
  certPath: string
  /** The proxy route that was applied. */
  containerConfig: ContainerConfig
  /** The proxy and CA-trust variables that were applied. */
  env: Record<string, string>
  /** Always `'platform'` — the credential backend that authenticated the proxy. */
  mode: 'platform'
}

/**
 * Build the proxy route for a platform session. The proxy authenticates with
 * HTTP Basic userinfo — username `x-agent-vault`, password = the session
 * token — so the token travels to the proxy on every request; keep the proxy
 * on a private network, as the platform docs warn.
 */
export function buildPlatformContainerConfig(
  address: URL,
  sessionToken: string,
  caCertificate: string,
): ContainerConfig {
  const proxyUrl = `${address.protocol}//x-agent-vault:${encodeURIComponent(sessionToken)}@${address.host}`

  return {
    caCertificate,
    env: {
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl,
      NO_PROXY: `localhost,127.0.0.1,${address.hostname}`,
    },
  }
}

/**
 * Client for one session against an Infisical platform Agent Vault proxy —
 * the SaaS backend (access bundles, time-bound sessions, enrolled proxies on
 * `:17323`), distinct from the self-hosted broker client (`AgentVault`).
 *
 * ```typescript
 * const proxy = new PlatformProxy({proxy: 'proxy.internal:17323', sessionToken: 'agv_...'})
 * const {certPath, env, mode} = await proxy.intercept()
 * // From here a plain request is intercepted and the credential injected:
 * await fetch('https://api.github.com/user') // no token in this process
 * ```
 */
export class PlatformProxy {
  private readonly address: URL
  private readonly caFingerprint?: string
  private readonly sessionToken: string

  constructor(config: PlatformProxyConfig) {
    this.address = normalizeProxyAddress(config.proxy)
    this.caFingerprint = config.caFingerprint
    this.sessionToken = config.sessionToken
  }

  /**
   * Fetch the proxy CA — verifying the configured fingerprint pin, when there
   * is one — write it to disk and apply the proxy plus CA-trust variables to
   * the target environment.
   *
   * There is no pre-flight validation of the session on the platform backend:
   * an expired or revoked session surfaces as 403s on the proxied requests
   * themselves (407 would mean the token went missing, 502/503 that the proxy
   * cannot reach Infisical or lost its own access).
   *
   * @throws {AgentVaultError} when the CA cannot be fetched or the fingerprint
   *   pin does not match. Callers fail closed rather than run unbrokered.
   */
  async intercept(options?: PlatformInterceptOptions): Promise<PlatformInterceptResult> {
    const caCertificate = await fetchProxyCa(this.address, options?.timeoutMs)

    if (this.caFingerprint && normalizeFingerprint(this.caFingerprint) !== certificateFingerprint(caCertificate)) {
      throw new AgentVaultError(
        'The Agent Vault proxy CA does not match the configured fingerprint (AGENT_VAULT_CA_FINGERPRINT / caFingerprint), so traffic was not brokered.',
      )
    }

    const containerConfig = buildPlatformContainerConfig(this.address, this.sessionToken, caCertificate)
    const {certPath, env} = await assembleInterceptedEnv(containerConfig, options)

    return {certPath, containerConfig, env, mode: 'platform'}
  }
}
```

And add the config type next to the other platform types at the top of the file (right after the constants):

```typescript
/** Configuration for the Infisical platform Agent Vault proxy client. */
export type PlatformProxyConfig = {
  /** Optional SHA-256 pin of the proxy CA (`SHA256:<hex>` or bare hex). */
  caFingerprint?: string
  /** Proxy address: `host:17323` or a full `http://`/`https://` URL. */
  proxy: string
  /** The session token (`agv_...`) issued by the dashboard. */
  sessionToken: string
}
```

Also extend the imports at the top of `platform.ts`:

```typescript
import {assembleInterceptedEnv, type AssembleEnvOptions} from './proxy.js'
import type {ContainerConfig} from './resources/mitm.js'
```

In `src/agent-vault/index.ts`, extend the platform export block:

```typescript
// Platform proxy — the Infisical SaaS Agent Vault backend (session token + enrolled proxy)
export {
  buildPlatformContainerConfig,
  certificateFingerprint,
  fetchProxyCa,
  normalizeFingerprint,
  normalizeProxyAddress,
  PlatformProxy,
} from './platform.js'

export type {PlatformInterceptOptions, PlatformInterceptResult, PlatformProxyConfig} from './platform.js'
```

(`src/index.ts` re-exports everything via `export *`, so no change there.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx mocha --forbid-only "test/agent-vault/platform.test.ts"`
Expected: PASS.

- [ ] **Step 5: Run the whole agent-vault suite**

Run: `npx mocha --forbid-only "test/agent-vault/*.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent-vault/platform.ts src/agent-vault/index.ts test/agent-vault/platform.test.ts
git commit -m "feat(agent-vault): add PlatformProxy client for the Infisical platform backend"
```

---

### Task 5: Process layer — `InterceptTarget`, detection, and the platform branch

**Files:**
- Modify: `src/agent-vault-process.ts`
- Test: `test/agent-vault-process.test.ts`

**Interfaces:**
- Consumes: `PlatformProxy` + `PlatformProxyConfig` (Task 4); `AgentVaultFileConfig.sessionToken/proxy/caFingerprint` (Task 1); `AgentVaultError` from `./agent-vault/index.js`.
- Produces (used by Task 6):
  - `type BrokerTarget = {kind: 'broker'; vault: string}`
  - `type PlatformTarget = {caFingerprint?: string; kind: 'platform'; proxy: string; sessionToken: string}`
  - `type InterceptTarget = BrokerTarget | PlatformTarget`
  - `SESSION_TOKEN_ENV = 'AGENT_VAULT_SESSION_TOKEN'`, `PROXY_ENV = 'AGENT_VAULT_PROXY'`, `CA_FINGERPRINT_ENV = 'AGENT_VAULT_CA_FINGERPRINT'` (exports)
  - `shouldIntercept(env?, fileConfig?): InterceptTarget | undefined` — throws `AgentVaultError` on lone platform fields
  - `runIntercepted(options)` — `target: InterceptTarget` replaces `vault: string`; new optional `platformProxy?: PlatformProxy` DI seam

- [ ] **Step 1: Update the existing tests mechanically, and add the new ones**

In `test/agent-vault-process.test.ts`:

**(a) Imports** — replace the import of `agent-vault-process.js` with:

```typescript
import {
  CA_FINGERPRINT_ENV,
  DISABLE_ENV,
  PROXY_ENV,
  runIntercepted,
  SESSION_TOKEN_ENV,
  SENTINEL_ENV,
  shouldIntercept,
  TOKEN_ENV,
  VAULT_ENV,
} from '../src/agent-vault-process.js'
import {AgentVault, AgentVaultError, PlatformProxy} from '../src/agent-vault/index.js'
```

**(b) REPORT_SCRIPT** — replace with:

```typescript
const REPORT_SCRIPT = `
const out = {
  https_proxy: process.env.HTTPS_PROXY,
  no_proxy: process.env.NO_PROXY,
  node_use_env_proxy: process.env.NODE_USE_ENV_PROXY,
  extra_ca: process.env.NODE_EXTRA_CA_CERTS,
  sentinel: process.env.${SENTINEL_ENV},
  token: process.env.${TOKEN_ENV} ?? null,
  vault: process.env.${VAULT_ENV} ?? null,
  session_token: process.env.${SESSION_TOKEN_ENV} ?? null,
  proxy: process.env.${PROXY_ENV} ?? null,
  ca_fingerprint: process.env.${CA_FINGERPRINT_ENV} ?? null,
  argv: process.argv.slice(2),
}
require('node:fs').writeFileSync(process.env.REPORT_FILE, JSON.stringify(out))
`
```

**(c) A platform stub server** — add next to `stubAgentVault`:

```typescript
/** A stub platform proxy serving the CA envelope on /_agent-vault/ca. */
async function startPlatformStub(): Promise<{server: Server; url: URL}> {
  const server = createServer((_request, response) => {
    response.writeHead(200, {'Content-Type': 'application/json'})
    response.end(JSON.stringify({certificate: CA_PEM}))
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const {port} = server.address() as AddressInfo
  return {server, url: new URL(`http://127.0.0.1:${port}`)}
}

function stopPlatformStub(server: Server): Promise<void> {
  server.closeAllConnections()
  return new Promise((resolve) => server.close(() => resolve()))
}
```

with `import {createServer, type Server} from 'node:http'` and `import {type AddressInfo} from 'node:net'` added at the top.

**(d) `shouldIntercept` tests** — replace the whole `describe('shouldIntercept')` block with:

```typescript
  describe('shouldIntercept', () => {
    it('detects a broker target when a token and a vault name are both present', () => {
      expect(shouldIntercept({[TOKEN_ENV]: 'av_agt_abc', [VAULT_ENV]: 'my-project'})).to.deep.equal({
        kind: 'broker',
        vault: 'my-project',
      })
    })

    it('stays off when either broker half is missing', () => {
      expect(shouldIntercept({[TOKEN_ENV]: 'av_agt_abc'})).to.equal(undefined)
      expect(shouldIntercept({[VAULT_ENV]: 'my-project'})).to.equal(undefined)
      expect(shouldIntercept({})).to.equal(undefined)
    })

    it('is off inside the re-executed child', () => {
      expect(
        shouldIntercept({
          [SENTINEL_ENV]: '1',
          [SESSION_TOKEN_ENV]: 'agv_abc',
          [PROXY_ENV]: 'proxy.internal:17323',
          [TOKEN_ENV]: 'av_agt_abc',
          [VAULT_ENV]: 'my-project',
        }),
      ).to.equal(undefined)
    })

    it('is off when explicitly disabled', () => {
      expect(
        shouldIntercept({
          [DISABLE_ENV]: '1',
          [SESSION_TOKEN_ENV]: 'agv_abc',
          [PROXY_ENV]: 'proxy.internal:17323',
        }),
      ).to.equal(undefined)
    })

    it('falls back to the file config for whichever broker half is missing from the environment', () => {
      expect(shouldIntercept({[TOKEN_ENV]: 'av_agt_abc'}, {vault: 'my-project'})).to.deep.equal({
        kind: 'broker',
        vault: 'my-project',
      })
      expect(shouldIntercept({}, {token: 'av_agt_file', vault: 'my-project'})).to.deep.equal({
        kind: 'broker',
        vault: 'my-project',
      })
    })

    it('prefers the environment over the file config', () => {
      expect(
        shouldIntercept({[TOKEN_ENV]: 'av_agt_abc', [VAULT_ENV]: 'env-project'}, {vault: 'file-project'}),
      ).to.deep.equal({kind: 'broker', vault: 'env-project'})
    })

    it('detects a platform target when the session token and proxy are both set', () => {
      expect(
        shouldIntercept({[SESSION_TOKEN_ENV]: 'agv_abc', [PROXY_ENV]: 'proxy.internal:17323'}),
      ).to.deep.equal({caFingerprint: undefined, kind: 'platform', proxy: 'proxy.internal:17323', sessionToken: 'agv_abc'})
    })

    it('carries the CA fingerprint pin through', () => {
      expect(
        shouldIntercept({
          [CA_FINGERPRINT_ENV]: 'SHA256:ABCD',
          [SESSION_TOKEN_ENV]: 'agv_abc',
          [PROXY_ENV]: 'proxy.internal:17323',
        }),
      ).to.deep.equal({
        caFingerprint: 'SHA256:ABCD',
        kind: 'platform',
        proxy: 'proxy.internal:17323',
        sessionToken: 'agv_abc',
      })
    })

    it('resolves platform fields from the file config, env winning per field', () => {
      expect(
        shouldIntercept({[PROXY_ENV]: 'env.internal:17323'}, {proxy: 'file.internal:17323', sessionToken: 'agv_file'}),
      ).to.deep.equal({
        caFingerprint: undefined,
        kind: 'platform',
        proxy: 'env.internal:17323',
        sessionToken: 'agv_file',
      })
    })

    it('throws when only the session token is set', () => {
      expect(() => shouldIntercept({[SESSION_TOKEN_ENV]: 'agv_abc'})).to.throw(
        AgentVaultError,
        /AGENT_VAULT_PROXY/,
      )
      expect(() => shouldIntercept({}, {sessionToken: 'agv_file'})).to.throw(AgentVaultError, /AGENT_VAULT_PROXY/)
    })

    it('throws when only the proxy is set', () => {
      expect(() => shouldIntercept({[PROXY_ENV]: 'proxy.internal:17323'})).to.throw(
        AgentVaultError,
        /AGENT_VAULT_SESSION_TOKEN/,
      )
    })

    it('prefers the platform backend when both backends are fully configured', () => {
      expect(
        shouldIntercept({
          [PROXY_ENV]: 'proxy.internal:17323',
          [SESSION_TOKEN_ENV]: 'agv_abc',
          [TOKEN_ENV]: 'av_agt_abc',
          [VAULT_ENV]: 'my-project',
        }),
      ).to.deep.equal({
        caFingerprint: undefined,
        kind: 'platform',
        proxy: 'proxy.internal:17323',
        sessionToken: 'agv_abc',
      })
    })
  })
```

**(e) `runIntercepted` broker call sites** — in every existing options object inside `describe('runIntercepted')`, replace `vault: 'my-project'` with `target: {kind: 'broker', vault: 'my-project'}` (8 occurrences; nothing else in those tests changes). Example — the first test becomes:

```typescript
      const code = await runIntercepted({
        agentVault: stubAgentVault(),
        argv: [script, 'some', 'args'],
        env: {REPORT_FILE: reportFile, [TOKEN_ENV]: 'av_agt_abc', [VAULT_ENV]: 'my-project'},
        execArgv: [],
        target: {kind: 'broker', vault: 'my-project'},
      })
```

**(f) New platform tests** — add inside `describe('runIntercepted')`:

```typescript
    it('re-executes with the platform proxy environment and withholds the platform variables', async () => {
      const stub = await startPlatformStub()
      try {
        const reportFile = join(tmpDir, 'platform-report.json')
        const script = join(tmpDir, 'platform-report.cjs')
        await writeFile(script, REPORT_SCRIPT, 'utf8')

        const code = await runIntercepted({
          argv: [script, 'some', 'args'],
          env: {
            REPORT_FILE: reportFile,
            [CA_FINGERPRINT_ENV]: 'SHA256:ABCD',
            [PROXY_ENV]: stub.url.origin,
            [SESSION_TOKEN_ENV]: 'agv_env',
          },
          execArgv: [],
          target: {kind: 'platform', proxy: stub.url.origin, sessionToken: 'agv_env'},
        })

        expect(code).to.equal(0)
        const seen = JSON.parse(await readFile(reportFile, 'utf8'))

        expect(seen.https_proxy).to.equal(`http://x-agent-vault:agv_env@127.0.0.1:${stub.url.port}`)
        expect(seen.node_use_env_proxy).to.equal('1')
        expect(seen.no_proxy).to.equal('localhost,127.0.0.1,127.0.0.1')
        expect(seen.sentinel).to.equal('1')
        expect(seen.argv).to.deep.equal(['some', 'args'])

        // The platform variables are withheld from the child: the session
        // token rides inside the proxy URL, and the sentinel stops re-entry.
        expect(seen.session_token).to.equal(null)
        expect(seen.proxy).to.equal(null)
        expect(seen.ca_fingerprint).to.equal(null)
      } finally {
        await stopPlatformStub(stub.server)
      }
    })

    it('fails closed when the platform CA pin does not match', async () => {
      const stub = await startPlatformStub()
      try {
        const error = await runIntercepted({
          argv: [join(tmpDir, 'never-runs.cjs')],
          env: {},
          execArgv: [],
          target: {caFingerprint: 'sha256:deadbeef', kind: 'platform', proxy: stub.url.origin, sessionToken: 'agv_env'},
        }).catch((error_: unknown) => error_)

        expect(error).to.be.instanceOf(AgentVaultError)
        expect((error as Error).message).to.match(/fingerprint/i)
      } finally {
        await stopPlatformStub(stub.server)
      }
    })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx mocha --forbid-only "test/agent-vault-process.test.ts"`
Expected: FAIL — compile errors first (`CA_FINGERPRINT_ENV` etc. not exported; `target` not a valid option; `PlatformProxy` not re-exported yet through `agent-vault/index.js` — it is after Task 4).

- [ ] **Step 3: Implement**

In `src/agent-vault-process.ts`:

**(a) Imports and constants** — replace the import block and env constants with:

```typescript
import {type ChildProcess, spawn} from 'node:child_process'
import {mkdtemp, rm} from 'node:fs/promises'
import {constants, tmpdir} from 'node:os'
import {join} from 'node:path'

import {AgentVault, AgentVaultError, PlatformProxy, type AgentVaultFileConfig} from './agent-vault/index.js'

/** Set in the re-executed child so it does not intercept itself again. */
export const SENTINEL_ENV = 'SDKCK_AGENT_VAULT_ACTIVE'
/** Escape hatch: skip interception for one invocation. */
export const DISABLE_ENV = 'SDKCK_AGENT_VAULT_DISABLED'
/** Vault whose credentials the OSS broker should proxy. */
export const VAULT_ENV = 'AGENT_VAULT_VAULT'
/** Extra comma-separated hosts to bypass the proxy for. */
export const NO_PROXY_ENV = 'AGENT_VAULT_NO_PROXY'
/** OSS-broker instance token, used to mint the scoped session. */
export const TOKEN_ENV = 'AGENT_VAULT_TOKEN'
/** OSS-broker management API address. */
export const ADDR_ENV = 'AGENT_VAULT_ADDR'
/** Infisical platform Agent Vault session token (`agv_...`). */
export const SESSION_TOKEN_ENV = 'AGENT_VAULT_SESSION_TOKEN'
/** Infisical platform Agent Vault proxy address. */
export const PROXY_ENV = 'AGENT_VAULT_PROXY'
/** Optional SHA-256 pin of the platform proxy CA. */
export const CA_FINGERPRINT_ENV = 'AGENT_VAULT_CA_FINGERPRINT'

/** The self-hosted OSS broker credential path. */
export type BrokerTarget = {kind: 'broker'; vault: string}
/** The Infisical SaaS platform proxy credential path. */
export type PlatformTarget = {caFingerprint?: string; kind: 'platform'; proxy: string; sessionToken: string}
/** Which backend an intercepted invocation runs under. */
export type InterceptTarget = BrokerTarget | PlatformTarget
```

**(b) `shouldIntercept`** — replace the whole function (and its doc comment) with:

```typescript
/**
 * Whether this invocation should be re-executed with its traffic intercepted,
 * and through which backend.
 *
 * Two backends share the machinery, auto-detected from which config fields
 * are present — tokens stay opaque, there is no prefix sniffing:
 *
 * - **platform** — the Infisical SaaS Agent Vault. Selected as soon as either
 *   platform field (`AGENT_VAULT_SESSION_TOKEN` / `AGENT_VAULT_PROXY`, from
 *   the environment or, for whichever is unset, `fileConfig`) is present; both
 *   are required, so a lone field throws rather than half-configuring. The
 *   optional CA pin rides along.
 * - **broker** — the self-hosted OSS broker, exactly as before:
 *   `AGENT_VAULT_TOKEN` plus `AGENT_VAULT_VAULT`, both or nothing.
 *
 * When both backends are fully configured the platform backend wins — a
 * documented resolution order, like env-over-file. Skipped inside the
 * re-executed child, and when `SDKCK_AGENT_VAULT_DISABLED` is set.
 *
 * @throws {AgentVaultError} when platform fields are present but incomplete.
 */
export function shouldIntercept(
  env: NodeJS.ProcessEnv = process.env,
  fileConfig: AgentVaultFileConfig = {},
): InterceptTarget | undefined {
  if (env[SENTINEL_ENV] || env[DISABLE_ENV]) return undefined

  const sessionToken = env[SESSION_TOKEN_ENV] ?? fileConfig.sessionToken
  const proxy = env[PROXY_ENV] ?? fileConfig.proxy
  if (sessionToken !== undefined || proxy !== undefined) {
    if (!sessionToken || !proxy) {
      throw new AgentVaultError(
        sessionToken
          ? `${PROXY_ENV} (or "proxy" in <configDir>/agent-vault.json) is required alongside ${SESSION_TOKEN_ENV}.`
          : `${SESSION_TOKEN_ENV} (or "sessionToken" in <configDir>/agent-vault.json) is required alongside ${PROXY_ENV}.`,
      )
    }

    return {
      caFingerprint: env[CA_FINGERPRINT_ENV] ?? fileConfig.caFingerprint,
      kind: 'platform',
      proxy,
      sessionToken,
    }
  }

  const token = env[TOKEN_ENV] ?? fileConfig.token
  const vault = env[VAULT_ENV] ?? fileConfig.vault
  return token && vault ? {kind: 'broker', vault} : undefined
}
```

Note the eslint-disable comment above the old function (`unicorn/consistent-boolean-name`) is removed with it.

**(c) `InterceptedRunOptions` and `runIntercepted`** — replace the options type and the function with:

```typescript
/** Options for {@link runIntercepted}. Everything is injectable for tests. */
export type InterceptedRunOptions = {
  /** Broker client, for the broker target. Defaults to one built from the environment. */
  agentVault?: AgentVault
  /** Arguments for the child, defaulting to this process's (`process.argv.slice(1)`). */
  argv?: string[]
  /** Environment to derive the child's from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
  /** Node options for the child, defaulting to this process's `execArgv`. */
  execArgv?: string[]
  /** Node binary to re-execute. Defaults to `process.execPath`. */
  execPath?: string
  /** Extra comma-separated hosts to bypass the proxy for. See {@link NO_PROXY_ENV}. */
  noProxy?: string
  /** Platform proxy client, for the platform target. Defaults to one built from the target. */
  platformProxy?: PlatformProxy
  /** Spawn implementation, for tests. */
  spawnFn?: typeof spawn
  /** Which backend to intercept with — resolved by {@link shouldIntercept}. */
  target: InterceptTarget
}

/**
 * Re-execute this CLI invocation with every outbound request routed through
 * the resolved backend's proxy, and resolve with the child's exit code.
 *
 * Node reads `NODE_USE_ENV_PROXY` and `NODE_EXTRA_CA_CERTS` when the process
 * starts, so mutating `process.env` in-flight would only cover child processes,
 * not this process's own `fetch` — which is where most commands do their HTTP.
 * Re-executing means the command runs in a process that *started* with the proxy
 * environment, so in-process requests, plugin traffic and any subprocess are all
 * intercepted.
 *
 * The parent's credential material is withheld from the child: for both
 * backends the proxy credential rides inside the proxy URL instead, and the
 * sentinel already stops the child from intercepting itself.
 *
 * @throws {Error} When the proxy route cannot be set up. Callers fail closed
 *   rather than run unbrokered.
 */
export async function runIntercepted(options: InterceptedRunOptions): Promise<number> {
  const sourceEnv = options.env ?? process.env
  const childEnv: NodeJS.ProcessEnv = {...sourceEnv, [SENTINEL_ENV]: '1'}
  for (const key of [TOKEN_ENV, SESSION_TOKEN_ENV, PROXY_ENV, CA_FINGERPRINT_ENV]) {
    Reflect.deleteProperty(childEnv, key)
  }

  const certDir = await mkdtemp(join(tmpdir(), 'sdkck-agent-vault-'))

  try {
    if (options.target.kind === 'broker') {
      const agentVault = options.agentVault ?? new AgentVault()
      await agentVault
        .vault(options.target.vault)
        .intercept({certPath: join(certDir, 'ca.pem'), env: childEnv, noProxy: options.noProxy})
    } else {
      const platformProxy =
        options.platformProxy ??
        new PlatformProxy({
          caFingerprint: options.target.caFingerprint,
          proxy: options.target.proxy,
          sessionToken: options.target.sessionToken,
        })
      await platformProxy.intercept({certPath: join(certDir, 'ca.pem'), env: childEnv, noProxy: options.noProxy})
    }

    return await spawnChild({
      argv: options.argv ?? process.argv.slice(1),
      env: childEnv,
      execArgv: options.execArgv ?? process.execArgv,
      execPath: options.execPath ?? process.execPath,
      spawnFn: options.spawnFn ?? spawn,
    })
  } finally {
    // The child has exited by now, so the certificate is no longer needed.
    await rm(certDir, {force: true, recursive: true})
  }
}
```

(`spawnChild` and `signalExitCode` below it are untouched.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx mocha --forbid-only "test/agent-vault-process.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent-vault-process.ts test/agent-vault-process.test.ts
git commit -m "feat(agent-vault): auto-detect the platform backend and intercept through the platform proxy"
```

---

### Task 6: Hook — resolve inside the try, backend-aware fail-closed message

**Files:**
- Modify: `src/hooks/init/setup-agent-vault.ts`
- Test: `test/hooks/init/setup-agent-vault.test.ts`

**Interfaces:**
- Consumes: `shouldIntercept`/`runIntercepted` with `InterceptTarget` (Task 5), `PlatformProxy` (Task 4).
- Produces: the hook — unchanged public surface; error message gains the `session through <proxy>` variant; resolution errors now surface with the disable hint.

- [ ] **Step 1: Write the failing tests**

In `test/hooks/init/setup-agent-vault.test.ts`:

**(a)** Extend the `envKeys` array with the three new variables:

```typescript
  const envKeys = [
    'AGENT_VAULT_TOKEN',
    'AGENT_VAULT_VAULT',
    'AGENT_VAULT_ADDR',
    'AGENT_VAULT_SESSION_TOKEN',
    'AGENT_VAULT_PROXY',
    'AGENT_VAULT_CA_FINGERPRINT',
    'SDKCK_AGENT_VAULT_DISABLED',
    'SDKCK_AGENT_VAULT_ACTIVE',
  ]
```

**(b)** Add these tests inside `describe('init/setup-agent-vault hook')`:

```typescript
  it('attempts interception for a platform session and fails closed when unreachable', async () => {
    process.env.AGENT_VAULT_SESSION_TOKEN = 'agv_env'
    process.env.AGENT_VAULT_PROXY = '127.0.0.1:1' // nothing listens here
    const {context, errorMessage} = makeContext(tmpDir)

    const error = await hook.call(context, makeOpts(tmpDir)).catch((error_: unknown) => error_)

    expect(error).to.be.instanceOf(Error)
    expect(errorMessage()).to.match(/session through 127\.0\.0\.1:1/)
    expect(errorMessage()).to.match(/command was not run/)
    expect(errorMessage()).to.match(/SDKCK_AGENT_VAULT_DISABLED=1/)
  })

  it('fails closed on an incomplete platform config, naming the missing variable', async () => {
    process.env.AGENT_VAULT_SESSION_TOKEN = 'agv_env'
    const {context, errorMessage} = makeContext(tmpDir)

    await hook.call(context, makeOpts(tmpDir)).catch((error_: unknown) => error_)

    expect(errorMessage()).to.match(/AGENT_VAULT_PROXY/)
    expect(errorMessage()).to.match(/command was not run/)
  })

  it('does not attempt platform interception when disabled', async () => {
    process.env.AGENT_VAULT_SESSION_TOKEN = 'agv_env'
    process.env.AGENT_VAULT_PROXY = 'proxy.internal:17323'
    process.env.SDKCK_AGENT_VAULT_DISABLED = '1'
    const {context} = makeContext(tmpDir)

    await hook.call(context, makeOpts(tmpDir))
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx mocha --forbid-only "test/hooks/init/setup-agent-vault.test.ts"`
Expected: FAIL — the platform tests fail (the hook ignores the new variables, so the first two see no error at all), while all pre-existing cases still pass.

- [ ] **Step 3: Implement**

Replace the body of `src/hooks/init/setup-agent-vault.ts` (keep the file's overall structure; update the doc comment and imports):

```typescript
import {type Hook} from '@oclif/core'

import {
  ADDR_ENV,
  DISABLE_ENV,
  NO_PROXY_ENV,
  runIntercepted,
  SENTINEL_ENV,
  shouldIntercept,
  TOKEN_ENV,
  type InterceptTarget,
} from '../../agent-vault-process.js'
import {AgentVault, AgentVaultError, PlatformProxy, readAgentVaultFileConfig} from '../../agent-vault/index.js'

/**
 * Routes every command's outbound traffic through Agent Vault, which injects
 * the real credentials in flight so no command holds a secret.
 *
 * Two backends, auto-detected by `shouldIntercept` from which config fields
 * are set: the Infisical SaaS platform Agent Vault (`AGENT_VAULT_SESSION_TOKEN`
 * + `AGENT_VAULT_PROXY`, both from the environment or `agent-vault.json`) or
 * the self-hosted OSS broker (`AGENT_VAULT_TOKEN` + `AGENT_VAULT_VAULT`). The
 * work happens by re-executing this invocation with the proxy environment in
 * place — Node reads `NODE_USE_ENV_PROXY` and `NODE_EXTRA_CA_CERTS` at
 * startup, so a process cannot proxy its own `fetch` by mutating
 * `process.env`. This hook therefore supervises: the child does the real work
 * and its exit code is passed straight through.
 *
 * Fails closed. If the proxy route cannot be set up the command does not run,
 * rather than sending requests that bypass the broker.
 *
 * `AGENT_VAULT_NO_PROXY` (or `noProxy` in the config file) adds hosts that
 * bypass the proxy entirely — for internal destinations the proxies refuse or
 * cannot serve (the platform proxy 403s unbundled hosts under strict policy;
 * the broker's MITM proxy 502s private IPs).
 */
const hook: Hook<'init'> = async function () {
  // Bypass checks come first and never touch the config file: a malformed,
  // unrelated agent-vault.json must not block the disable escape hatch, nor
  // break the re-executed child (which hits this hook again with the
  // sentinel set).
  if (process.env[SENTINEL_ENV] || process.env[DISABLE_ENV]) return

  // Read once against the real configDir, so the backend resolved here and
  // the credentials the child is set up with can never disagree with each
  // other about which config file backed them.
  const fileConfig = readAgentVaultFileConfig(this.config.configDir)

  // Only setup failures are caught here: this.exit() throws, and catching that
  // would turn a clean child run into a spurious "interception failed".
  let target: InterceptTarget | undefined
  let exitCode = 1
  try {
    target = shouldIntercept(process.env, fileConfig)
    if (!target) return

    const noProxy = process.env[NO_PROXY_ENV] ?? fileConfig.noProxy
    exitCode = await runIntercepted({
      agentVault:
        target.kind === 'broker'
          ? new AgentVault({
              address: process.env[ADDR_ENV] ?? fileConfig.address,
              token: process.env[TOKEN_ENV] ?? fileConfig.token,
            })
          : undefined,
      noProxy,
      platformProxy:
        target.kind === 'platform'
          ? new PlatformProxy({
              caFingerprint: target.caFingerprint,
              proxy: target.proxy,
              sessionToken: target.sessionToken,
            })
          : undefined,
      target,
    })
  } catch (error) {
    const reason = error instanceof AgentVaultError || error instanceof Error ? error.message : String(error)
    const subject =
      target?.kind === 'platform'
        ? `session through ${target.proxy}`
        : target
          ? `vault "${target.vault}"`
          : undefined
    this.error(
      `Agent Vault interception could not be set up${subject ? ` for ${subject}` : ''}, so the command was not run: ${reason}\n` +
        `Set ${DISABLE_ENV}=1 to run without brokered credentials.`,
      {exit: 1},
    )
  }

  // The command already ran in the child, so pass its status through verbatim
  // and stop — returning here would let oclif dispatch the command a second
  // time. process.exit is deliberate: this process is only a supervisor, and
  // nothing is buffered because the child inherited its stdio.
  // eslint-disable-next-line unicorn/no-process-exit -- CLI supervisor, see above
  process.exit(exitCode)
}

export default hook
```

- [ ] **Step 4: Run the hook tests and the process tests**

Run: `npx mocha --forbid-only "test/hooks/init/setup-agent-vault.test.ts" "test/agent-vault-process.test.ts"`
Expected: PASS — including the pre-existing broker cases (`vault "file-project"` wording is preserved).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/init/setup-agent-vault.ts test/hooks/init/setup-agent-vault.test.ts
git commit -m "feat(agent-vault): fail closed with backend-aware messages in the interception hook"
```

---

### Task 7: Documentation

**Files:**
- Modify: `CLAUDE.md` (Agent Vault SDK section, hook section, Environment section)
- Modify: `README.md` (Credential Brokering section)
- Modify: `docs/src/app/agent-vault/page.mdx`

**Interfaces:**
- Consumes: the shipped behavior from Tasks 1–6.
- Produces: docs only.

- [ ] **Step 1: CLAUDE.md**

In the `### Agent Vault SDK (`src/agent-vault/`)` section, insert directly after the intro paragraph (the one ending "…configure those through the Agent Vault CLI or dashboard."):

```markdown
**Two backends share this SDK, auto-detected from which config fields are set — tokens stay opaque, there is no prefix sniffing:**

<!-- prettier-ignore -->
| backend | fields | what it is |
| --- | --- | --- |
| `platform` | `sessionToken` (`agv_...`) + `proxy` (`host:17323`) | Infisical SaaS Agent Vault: access bundles, time-bound sessions, enrolled forward proxies. CA from `GET http://<proxy>/_agent-vault/ca` (JSON `.certificate`); proxy auth via HTTP Basic userinfo `x-agent-vault:<token>`. Client: `PlatformProxy` (`src/agent-vault/platform.ts`). |
| `broker` | `token` (`av_agt_...`) + `vault` | Self-hosted OSS broker ([github.com/Infisical/agent-vault](https://github.com/Infisical/agent-vault)): management API `:14321`, MITM proxy `:14322`. Client: `AgentVault`/`VaultClient`. |

When both are fully configured the platform backend wins (documented resolution order, like env-over-file). A lone platform field throws instead of half-configuring; a lone broker field is silently ignored (unchanged). Both backends produce the same `ContainerConfig` and share the env-assembly tail (`assembleInterceptedEnv` in `src/agent-vault/proxy.ts` — the single implementation of `buildProxyEnv`'s variable set).
```

In the `#### Intercepting every command (`setup-agent-vault` init hook)` section, replace the first paragraph's opening ("With a token and a vault both resolvable — …") with:

```markdown
With either backend's fields resolvable — platform `AGENT_VAULT_SESSION_TOKEN`+`AGENT_VAULT_PROXY`, or broker `AGENT_VAULT_TOKEN`+`AGENT_VAULT_VAULT`, each from the environment or `<configDir>/agent-vault.json` (platform fields win when both are configured) — every sdkck invocation runs with its outbound traffic brokered: the `setup-agent-vault` init hook (`src/hooks/init/setup-agent-vault.ts`) reads the config file once against the real `configDir` (so the interception decision and the credentials used to act on it never disagree), resolves an `InterceptTarget` (`shouldIntercept` in `src/agent-vault-process.ts`), sets up the proxy route (fetching the platform proxy's CA from `/_agent-vault/ca` via `node:http`, verifying an optional `caFingerprint` SHA-256 pin), and **re-executes the same invocation** with the proxy environment applied, then exits with the child's status.
```

In the `## Environment` section, insert after the `AGENT_VAULT_NO_PROXY` bullet:

```markdown
- **`AGENT_VAULT_SESSION_TOKEN` / `AGENT_VAULT_PROXY`:** Infisical *platform* Agent Vault session token (`agv_...`, issued once by the dashboard) and proxy address (`host:17323` or an `http(s)://` URL). Each falls back to the `sessionToken`/`proxy` fields of `<configDir>/agent-vault.json`. Having either one set (from any source) turns on platform-backend interception — both are required, and a lone field fails the command with a naming error. `AGENT_VAULT_CA_FINGERPRINT` (or `caFingerprint` in the file) pins the proxy CA as an optional SHA-256 fingerprint (`SHA256:...` or bare hex) and aborts on mismatch. Session lifecycle (create/revoke) stays with the Infisical dashboard or the infisical CLI; an expired/revoked session surfaces as 403s on proxied requests, not at startup.
```

- [ ] **Step 2: README.md**

In the `### Credential Brokering (Agent Vault)` section, insert right after the section heading a platform-first bullet set:

```markdown
- Two backends, auto-detected: the **Infisical platform Agent Vault** (SaaS) and the **self-hosted OSS broker**. For the platform one, create an access bundle and a session in the Infisical dashboard, enroll a proxy, then export the two values it gives you:

  ```bash
  export AGENT_VAULT_SESSION_TOKEN=agv_...   # from Sessions → Create Session
  export AGENT_VAULT_PROXY=proxy.internal:17323
  export AGENT_VAULT_CA_FINGERPRINT=SHA256:...   # optional CA pin

  # Nothing else to configure — every invocation is brokered from here on
  sdkck jira issue PROJ-123
  ```

  No wrapper command and no infisical CLI: existing `sdkck <command>` invocations are re-executed with the proxy environment automatically. Both values (plus `sessionToken`/`proxy`/`caFingerprint`) can instead live in `<configDir>/agent-vault.json`. `SDKCK_AGENT_VAULT_DISABLED=1` skips brokering for one invocation.
```

Keep the existing broker bullet and the rest of the section unchanged below it.

- [ ] **Step 3: docs site page**

In `docs/src/app/agent-vault/page.mdx`, insert a new section immediately after the first paragraph of the page ("Run commands without giving them real secrets…"):

```markdown
## Infisical platform Agent Vault (SaaS)

Sidekick also speaks Infisical's hosted Agent Vault: **access bundles** hold your services and real credentials, **sessions** are time-bound grants, and an **enrolled proxy** (port `17323`) injects the credential on the wire. Create the bundle and a session in the Infisical dashboard, enroll a proxy, then give Sidekick the session token and the proxy address:

```bash
export AGENT_VAULT_SESSION_TOKEN=agv_...
export AGENT_VAULT_PROXY=proxy.internal:17323
export AGENT_VAULT_CA_FINGERPRINT=SHA256:...   # optional pin of the proxy CA

sdkck jira issue PROJ-123
```

There is no wrapper to run and no infisical CLI to install: the invocation is re-executed with the proxy environment, exactly as with the broker backend. Both values can instead come from `<configDir>/agent-vault.json` (`"sessionToken"`, `"proxy"`, `"caFingerprint"`).

Sidekick fetches the proxy's root CA from `http://<proxy>/_agent-vault/ca` at startup, pins it when `AGENT_VAULT_CA_FINGERPRINT` is set, and routes all traffic through `http://x-agent-vault:<session-token>@<proxy>`. Sessions are created and revoked in the Infisical dashboard (or by the infisical CLI); an expired or revoked session shows up as `403`s on proxied requests — `407` means the token went missing, `502`/`503` that the proxy cannot reach Infisical or lost its own access.

When **both** backends are configured the platform backend wins. The self-hosted broker below remains fully supported.
```

- [ ] **Step 4: Verify the docs build**

Run: `cd docs && npm run build 2>&1 | tail -5; cd ..` — if the docs workspace has no build script or fails for unrelated pre-existing reasons, note it and move on (MDX is plain markdown here; nothing dynamic was added).
Expected: no new errors from the edited page.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md docs/src/app/agent-vault/page.mdx
git commit -m "docs(agent-vault): document the Infisical platform backend and auto-detection"
```

---

### Task 8: Full verification and live smoke test

**Files:**
- None (verification only)

**Interfaces:**
- Consumes: everything shipped in Tasks 1–7.
- Produces: confidence; a checklist result to report.

- [ ] **Step 1: Whole unit suite**

Run: `npm test`
Expected: PASS (mocha suite; the pre-existing `posttest` lint false-positive on `bin/run.js` documented in CLAUDE.md's Gotchas is not a regression).

- [ ] **Step 2: Lint and build**

Run: `npm run lint && npm run build`
Expected: no new errors. Fix any eslint/prettier findings in the touched files.

- [ ] **Step 3: Dead-code check**

Run: `npm run find-deadcode` and confirm none of the new exports (`PlatformProxy`, `assembleInterceptedEnv`, `buildPlatformContainerConfig`, `certificateFingerprint`, `fetchProxyCa`, `normalizeFingerprint`, `normalizeProxyAddress`, types) are flagged beyond the known `run`/`default` ignore list; if flagged, confirm they are exercised through `src/index.ts`'s `export *` and by tests before accepting.

- [ ] **Step 4: Live smoke test against the real proxy (requires the user)**

Ask the user for: the actual proxy host (`<proxy-host>:17323`), a fresh `agv_…` session token (the one shared in chat may have expired), and one service host covered by their access bundle (visible in the dashboard's bundle page). Then run, with a covered host substituted for `<bundled-host>`:

```bash
# 1. Brokered: succeeds with the real credential injected in flight
AGENT_VAULT_SESSION_TOKEN=<fresh-token> AGENT_VAULT_PROXY=<proxy-host>:17323 \
  ./bin/dev.js api call 2>/dev/null || true   # any command that hits <bundled-host>

# 2. Direct comparison outside brokering: the same request fails unauthenticated
curl -sS -o /dev/null -w "%{http_code}\n" https://<bundled-host>

# 3. Escape hatch: the command runs unbrokered (and fails auth, proving no leak)
SDKCK_AGENT_VAULT_DISABLED=1 AGENT_VAULT_SESSION_TOKEN=<fresh-token> \
  AGENT_VAULT_PROXY=<proxy-host>:17323 ./bin/dev.js <same command>

# 4. Pin mismatch aborts before the command runs
AGENT_VAULT_SESSION_TOKEN=<fresh-token> AGENT_VAULT_PROXY=<proxy-host>:17323 \
  AGENT_VAULT_CA_FINGERPRINT=sha256:deadbeef ./bin/dev.js --version

# 5. Config-file path: write ~/.config/sdkck/agent-vault.json with
#    {"sessionToken": "...", "proxy": "..."} and re-run check 1 without env vars.
```

Expected: (1) the child's request to `<bundled-host>` is authenticated while (2) fails — the proxy logs the request as brokered; (3) behaves like (2); (4) exits 1 with the fingerprint error and the disable hint; (5) equals (1).

- [ ] **Step 5: Final commit (if the smoke test prompted fixes)**

```bash
git add -A
git commit -m "fix(agent-vault): address live smoke-test findings"
```

---

## Self-Review (completed at plan time)

- **Spec coverage:** config fields (Task 1 = spec §4 table), shared assembly (Task 2 = spec §5 last bullet), CA fetch/pin/normalization (Task 3 = spec §5), `PlatformProxy` + route (Task 4 = spec §5), `InterceptTarget`/detection/child-env hygiene (Task 5 = spec §4, §6), hook fail-closed + messages (Task 6 = spec §6, §7), docs (Task 7 = spec §9), live verification incl. pin mismatch and NO_PROXY (Task 8 = spec §10; NO_PROXY is covered by existing `AGENT_VAULT_NO_PROXY` plumbing exercised in Task 4's merge test). Out-of-scope items (§11) appear in no task, as intended.
- **Placeholder scan:** none — every code step carries its full code; Task 8's `<fresh-token>`/`<proxy-host>`/`<bundled-host>` are user-supplied runtime inputs, collected in Step 4, not unwritten plan content.
- **Type consistency:** `InterceptTarget`/`BrokerTarget`/`PlatformTarget`, `SESSION_TOKEN_ENV`/`PROXY_ENV`/`CA_FINGERPRINT_ENV`, `assembleInterceptedEnv`/`AssembleEnvOptions`, `PlatformProxy`/`PlatformProxyConfig`/`PlatformInterceptOptions`/`PlatformInterceptResult`, and `buildPlatformContainerConfig` are spelled identically across Tasks 2–6 and their tests; the hook and `runIntercepted` consume exactly the shapes Tasks 4–5 produce.
