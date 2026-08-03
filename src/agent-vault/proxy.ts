import {constants as fsConstants} from 'node:fs'
import {mkdir, mkdtemp, open, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'

import type {ContainerConfig, CreateSessionOptions, Session} from './resources/sessions.js'
import type {VaultClient} from './vault.js'

import {AgentVaultError, ApiError} from './errors.js'
import {buildContainerConfig} from './resources/mitm.js'
import {buildProxyEnv} from './resources/sessions.js'

/**
 * The certificate is always written to a file this call creates itself: O_EXCL
 * fails rather than opening anything that already exists, including a symbolic
 * link. Unlike O_NOFOLLOW this holds on Windows too, where the no-follow flag
 * does not exist and a junction would otherwise be followed.
 */
const CERT_WRITE_FLAGS =
  // eslint-disable-next-line no-bitwise -- open(2) flags are a bit mask
  fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL

/** Private per-process directory holding the default certificate. */
let defaultCertDir: Promise<string> | undefined

/**
 * Path the root CA lands on when the caller does not choose one: a file inside
 * a freshly created private directory (mode 0700, unpredictable name), so
 * nothing pre-created in the shared temp directory can capture the write. The
 * directory is created once per process and reused.
 */
export async function defaultCertPath(): Promise<string> {
  if (!defaultCertDir) {
    const pending = mkdtemp(join(tmpdir(), 'agent-vault-'))
    defaultCertDir = pending
    pending.catch(() => {
      if (defaultCertDir === pending) defaultCertDir = undefined
    })
  }

  return join(await defaultCertDir, 'ca.pem')
}

/**
 * Which credential the proxy is authenticated with.
 *
 * - `session` — mint a short-lived vault-scoped session. Needs a `member`-or-
 *   better token, and is the stronger option when available: the credential is
 *   scoped and expires.
 * - `agent` — use the configured token as the proxy credential directly, after
 *   validating it. This is what a `proxy`-role token requires, since the server
 *   refuses to mint from one; it mirrors the agent mode of `agent-vault run`.
 * - `auto` — mint if the token is allowed to, otherwise fall back to `agent`.
 */
export type InterceptMode = 'agent' | 'auto' | 'session'

/** Options for {@link interceptRequests}. */
export interface InterceptOptions extends CreateSessionOptions {
  /**
   * Where to write the root CA certificate. Defaults to a file in a private
   * directory created for this process ({@link defaultCertPath}). Pass a path
   * inside the container's mount when the env is destined for a sandbox rather
   * than this process.
   */
  certPath?: string
  /**
   * Environment object to mutate. Defaults to `process.env`. Pass a plain
   * object to build an env for a child process without touching this one.
   */
  env?: NodeJS.ProcessEnv
  /** Which credential to authenticate the proxy with. Defaults to `auto`. */
  mode?: InterceptMode
  /**
   * Extra comma-separated hosts to add to `NO_PROXY`, on top of the ones the
   * broker already returns (`localhost`, `127.0.0.1`, its own host). Requests
   * to internal-only destinations that Agent Vault was never meant to broker
   * — e.g. the private-IP SSRF guard on Agent Vault's own MITM proxy rejects
   * them outright with a 502 — need to bypass the proxy rather than being
   * blocked by it.
   */
  noProxy?: string
  /** Skip writing the CA certificate — set when it is already on disk at `certPath`. */
  skipCertWrite?: boolean
}

/** Append extra hosts to a `NO_PROXY` value, skipping blanks and duplicates. */
function mergeNoProxy(base: string, extra?: string): string {
  if (!extra) return base

  const seen = new Set(
    base
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean),
  )
  const additions = extra
    .split(',')
    .map((host) => host.trim())
    .filter((host) => host && !seen.has(host))

  return additions.length > 0 ? [base, ...additions].join(',') : base
}

/** What {@link interceptRequests} configured. */
export interface InterceptResult {
  /** Path the root CA certificate was written to. */
  certPath: string
  /** The proxy route that was applied. */
  containerConfig: ContainerConfig
  /** The proxy and CA-trust variables that were applied. */
  env: Record<string, string>
  /** Which credential ended up authenticating the proxy. */
  mode: 'agent' | 'session'
  /**
   * The session backing the proxy credential, including its expiry — `null` in
   * agent mode, where the configured token is used as it arrived and no session
   * was minted.
   */
  session: null | Session
}

/**
 * Write the root CA certificate so TLS clients can trust the proxy's
 * on-the-fly certificates.
 *
 * The write never follows a link. Anything already at `certPath` is unlinked
 * first — which removes a symbolic link itself rather than its target — and the
 * certificate then goes into a file this call creates exclusively. Repeated
 * calls therefore still overwrite, but a link planted at the path is replaced
 * instead of being written through, on every platform.
 *
 * @returns The path written to.
 * @throws {AgentVaultError} when something re-creates the path mid-write.
 */
export async function writeCaCertificate(config: ContainerConfig, certPath: string): Promise<string> {
  await mkdir(dirname(certPath), {mode: 0o700, recursive: true})
  await rm(certPath, {force: true})

  let handle
  try {
    handle = await open(certPath, CERT_WRITE_FLAGS, 0o600)
  } catch (error) {
    const {code} = error as {code?: string}
    if (code === 'EEXIST') {
      throw new AgentVaultError(
        `Refusing to write the root CA certificate to ${certPath}: the path was re-created while writing.`,
      )
    }

    throw error
  }

  try {
    await handle.writeFile(config.caCertificate, 'utf8')
  } finally {
    await handle.close()
  }

  return certPath
}

/**
 * Apply proxy and CA-trust variables to an environment object.
 *
 * @param env - Variables from {@link buildProxyEnv}.
 * @param target - Environment to mutate. Defaults to `process.env`.
 */
export function applyProxyEnv(env: Record<string, string>, target: NodeJS.ProcessEnv = process.env): void {
  // Drop other spellings of the keys being set. Node's env is case-sensitive on
  // POSIX, and clients disagree on which spelling wins — curl and libcurl-backed
  // Python read lowercase `https_proxy` first — so a stale value inherited from
  // the parent shell could otherwise route around the broker entirely.
  const claimed = new Set(Object.keys(env).map((key) => key.toUpperCase()))
  for (const key of Object.keys(target)) {
    if (!(key in env) && claimed.has(key.toUpperCase())) delete target[key]
  }

  Object.assign(target, env)
}

/** Whether a failed mint means "this token may only proxy" rather than a real error. */
function isMintForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403
}

/**
 * Resolve the proxy route, choosing the credential according to `mode`.
 *
 * @throws {AgentVaultError} when MITM is disabled, or when the token is rejected.
 */
async function resolveRoute(
  vault: VaultClient,
  options: InterceptOptions | undefined,
): Promise<{containerConfig: ContainerConfig; mode: 'agent' | 'session'; session: null | Session}> {
  const mode = options?.mode ?? 'auto'

  if (mode !== 'agent') {
    try {
      const session = await vault.sessions.create({ttlSeconds: options?.ttlSeconds})
      if (!session.containerConfig) throw mitmDisabled()
      return {containerConfig: session.containerConfig, mode: 'session', session}
    } catch (error) {
      // A 403 is the server telling us this token may only proxy — which is a
      // perfectly good credential, so fall back rather than fail. Anything else
      // is a real failure and must not be mistaken for a proxy-role token.
      if (mode === 'session' || !isMintForbidden(error)) throw error
    }
  }

  // Agent mode: the configured token *is* the proxy credential. Validate it once
  // here so a bad token fails at startup instead of turning every proxied
  // request into a 401.
  const [, mitmInfo] = await Promise.all([vault.discover.validate(), vault.mitm.info()])
  if (!mitmInfo) throw mitmDisabled()

  return {
    containerConfig: buildContainerConfig(mitmInfo, vault._httpClient.getToken(), vault.name),
    mode: 'agent',
    session: null,
  }
}

function mitmDisabled(): AgentVaultError {
  return new AgentVaultError(
    'Agent Vault has MITM disabled (started with --mitm-port 0), so requests cannot be intercepted.',
  )
}

/**
 * Route outbound requests through the Agent Vault proxy so credentials are
 * injected in transit and never held by the caller.
 *
 * Mints a vault-scoped session, writes the root CA certificate to disk and
 * applies the proxy plus CA-trust variables to the target environment. From
 * then on, a request to a configured host — `fetch('https://api.stripe.com/v1/charges')` —
 * travels through the proxy, which substitutes the real credential for the
 * matching service rule before forwarding.
 *
 * Two caveats worth knowing:
 *
 * - Child processes inherit `process.env`, so anything spawned afterwards is
 *   covered unconditionally. For *this* process, Node only honours the proxy
 *   variables for `fetch` when `NODE_USE_ENV_PROXY=1` is set before the first
 *   request (Node v22.21.0+); {@link buildProxyEnv} sets it, so call this
 *   before issuing any traffic. Older runtimes need an explicit proxy agent
 *   built from the returned `env`.
 * - The vault's credentials and service rules have to exist already — the
 *   proxy injects what the vault has been told about, and rules are managed
 *   through the Agent Vault CLI or dashboard.
 *
 * @throws {AgentVaultError} when the server runs with MITM disabled, since
 *   there is then no proxy to intercept anything.
 */
export async function interceptRequests(vault: VaultClient, options?: InterceptOptions): Promise<InterceptResult> {
  const {containerConfig, mode, session} = await resolveRoute(vault, options)

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

  return {certPath, containerConfig, env, mode, session}
}
