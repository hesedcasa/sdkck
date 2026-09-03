import type {VaultClient} from './vault.js'

import {applyRoute, type ApplyRouteOptions, buildProxyEnv} from '../proxy-env.js'
import {AgentVaultError, ApiError} from './errors.js'
import {buildContainerConfig} from './resources/mitm.js'
import {type ContainerConfig, type CreateSessionOptions, type Session} from './resources/sessions.js'

// The proxy/certificate plumbing is shared with the Agent Proxy client — see
// `src/proxy-env.ts`. Re-exported here so `AgentVault`'s public surface is
// unchanged by the move.
export {applyProxyEnv, defaultCertPath, writeCaCertificate} from '../proxy-env.js'
export type {ProxyRoute} from '../proxy-env.js'

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
export type InterceptOptions = ApplyRouteOptions &
  CreateSessionOptions & {
    /** Which credential to authenticate the proxy with. Defaults to `auto`. */
    mode?: InterceptMode
  }

/** What {@link interceptRequests} configured. */
export type InterceptResult = {
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
  const {certPath, env} = await applyRoute(containerConfig, options)

  return {certPath, containerConfig, env, mode, session}
}
