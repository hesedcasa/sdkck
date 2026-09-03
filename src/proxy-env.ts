import {constants as fsConstants} from 'node:fs'
import {mkdir, mkdtemp, open, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'

import {AgentVaultError} from './agent-vault/errors.js'

/**
 * Broker-neutral proxy plumbing.
 *
 * Infisical ships two credential brokers, and both hand the caller the same
 * thing on the wire: an HTTP proxy that substitutes the real credential in
 * flight, plus a root CA to trust for the certificates it mints. Agent Vault
 * returns that as a container config from `POST /v1/sessions`; Agent Proxy's
 * `connect` wrapper assembles it from a machine identity token and a CA on
 * disk. Everything downstream of "which proxy URL and which CA" is identical,
 * so it lives here and both brokers share it.
 *
 * `AgentVaultError` is this package's umbrella type for a local broker failure.
 * It carries the name of the client that came first; `AgentProxyError` extends
 * it, so one `catch` covers both brokers and this shared layer.
 */

/**
 * The certificate is always written to a file this call creates itself: O_EXCL
 * fails rather than opening anything that already exists, including a symbolic
 * link. Unlike O_NOFOLLOW this holds on Windows too, where the no-follow flag
 * does not exist and a junction would otherwise be followed.
 */
const CERT_WRITE_FLAGS =
  // eslint-disable-next-line no-bitwise -- open(2) flags are a bit mask
  fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL

/** A resolved proxy route: where to send traffic, and the CA that signs it. */
export type ProxyRoute = {
  /** Root CA certificate PEM. Write it out and point the CA trust variables at it. */
  caCertificate: string
  /** Environment variables carrying the proxy route. */
  env: {
    /** Same proxy URL, used for plain `http://` upstreams. */
    HTTP_PROXY: string
    /** Proxy URL with the proxy credential embedded. */
    HTTPS_PROXY: string
    /** Hosts that bypass the proxy. */
    NO_PROXY: string
  }
}

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
    const pending = mkdtemp(join(tmpdir(), 'sdkck-proxy-'))
    defaultCertDir = pending
    pending.catch(() => {
      if (defaultCertDir === pending) defaultCertDir = undefined
    })
  }

  return join(await defaultCertDir, 'ca.pem')
}

/**
 * Expand a {@link ProxyRoute} into the complete env var set for a process or
 * container, including the CA trust variables honoured by Node.js, Python,
 * curl, Git and Deno.
 *
 * The same list covers both brokers: Agent Vault's `augmentEnvWithMITM()`
 * (cmd/run.go) and the Infisical CLI's `agent-proxy connect` set exactly these
 * trust variables, so keep it in sync with both.
 *
 * @param route - The resolved proxy route.
 * @param certPath - Path the CA certificate is readable at, from the process
 *   that will use it — inside the container's mount when it is destined for a
 *   sandbox rather than this machine.
 */
export function buildProxyEnv(route: ProxyRoute, certPath: string): Record<string, string> {
  return {
    CURL_CA_BUNDLE: certPath,
    DENO_CERT: certPath,
    GIT_SSL_CAINFO: certPath,
    HTTP_PROXY: route.env.HTTP_PROXY,
    HTTPS_PROXY: route.env.HTTPS_PROXY,
    NO_PROXY: route.env.NO_PROXY,
    NODE_EXTRA_CA_CERTS: certPath,
    NODE_USE_ENV_PROXY: '1',
    OPENCLAW_PROXY_URL: route.env.HTTPS_PROXY,
    REQUESTS_CA_BUNDLE: certPath,
    SSL_CERT_FILE: certPath,
  }
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
export async function writeCaCertificate(route: ProxyRoute, certPath: string): Promise<string> {
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
    await handle.writeFile(route.caCertificate, 'utf8')
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
    if (!(key in env) && claimed.has(key.toUpperCase())) Reflect.deleteProperty(target, key)
  }

  Object.assign(target, env)
}

/** Options for {@link applyRoute}. */
export type ApplyRouteOptions = {
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
  /**
   * Extra comma-separated hosts to add to `NO_PROXY`, on top of the ones the
   * route already carries. Requests to internal-only destinations the broker
   * was never meant to reach need to bypass the proxy rather than be rejected
   * by it.
   */
  noProxy?: string
  /** Skip writing the CA certificate — set when it is already on disk at `certPath`. */
  skipCertWrite?: boolean
}

/** What {@link applyRoute} configured. */
export type AppliedRoute = {
  /** Path the root CA certificate is readable at. */
  certPath: string
  /** The proxy and CA-trust variables that were applied. */
  env: Record<string, string>
}

/**
 * Persist the root CA and apply a resolved route to an environment.
 *
 * The tail every broker shares: write the certificate, expand the route into
 * the full trust/proxy variable set, merge the bypass lists and install them.
 */
export async function applyRoute(route: ProxyRoute, options?: ApplyRouteOptions): Promise<AppliedRoute> {
  const certPath = options?.certPath ?? (await defaultCertPath())
  if (!options?.skipCertWrite) {
    await writeCaCertificate(route, certPath)
  }

  const targetEnv = options?.env ?? process.env
  const env = buildProxyEnv(route, certPath)
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
