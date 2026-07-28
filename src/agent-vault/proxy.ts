import {constants as fsConstants} from 'node:fs'
import {mkdir, mkdtemp, open, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'

import type {ContainerConfig, CreateSessionOptions, Session, SessionsResource} from './resources/sessions.js'

import {AgentVaultError} from './errors.js'
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
  /** Skip writing the CA certificate — set when it is already on disk at `certPath`. */
  skipCertWrite?: boolean
}

/** What {@link interceptRequests} configured. */
export interface InterceptResult {
  /** Path the root CA certificate was written to. */
  certPath: string
  /** The proxy and CA-trust variables that were applied. */
  env: Record<string, string>
  /** The session backing the proxy credentials, including its expiry. */
  session: Session
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
  Object.assign(target, env)
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
export async function interceptRequests(
  sessions: SessionsResource,
  options?: InterceptOptions,
): Promise<InterceptResult> {
  const session = await sessions.create({ttlSeconds: options?.ttlSeconds})

  if (!session.containerConfig) {
    throw new AgentVaultError(
      'Agent Vault has MITM disabled (started with --mitm-port 0), so requests cannot be intercepted.',
    )
  }

  const certPath = options?.certPath ?? (await defaultCertPath())
  if (!options?.skipCertWrite) {
    await writeCaCertificate(session.containerConfig, certPath)
  }

  const env = buildProxyEnv(session.containerConfig, certPath)
  applyProxyEnv(env, options?.env ?? process.env)

  return {certPath, env, session}
}
