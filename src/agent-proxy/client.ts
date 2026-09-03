import {resolveConfigDir} from '../agent-vault/config-file.js'
import {applyRoute, type ApplyRouteOptions, type ProxyRoute} from '../proxy-env.js'
import {loginUniversalAuth} from './auth.js'
import {resolveCaCertificate} from './ca.js'
import {type AgentProxyFileConfig, readAgentProxyFileConfig} from './config-file.js'
import {AgentProxyError} from './errors.js'
import {buildAgentProxyRoute} from './route.js'
import {type AgentProxyConfig} from './types.js'

/** Environment variables the Agent Proxy client reads. */
export const ENV = {
  ADDRESS: 'INFISICAL_AGENT_PROXY_ADDRESS',
  CA: 'INFISICAL_AGENT_PROXY_CA',
  CLIENT_ID: 'INFISICAL_UNIVERSAL_AUTH_CLIENT_ID',
  CLIENT_SECRET: 'INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET',
  DOMAIN: 'INFISICAL_DOMAIN',
  NO_PROXY: 'INFISICAL_AGENT_PROXY_NO_PROXY',
  TOKEN: 'INFISICAL_TOKEN',
} as const

/** Options for {@link AgentProxy.intercept}. */
export type AgentProxyInterceptOptions = ApplyRouteOptions

/** What {@link AgentProxy.intercept} configured. */
export type AgentProxyInterceptResult = {
  /** Path the root CA certificate was written to. */
  certPath: string
  /** The proxy and CA-trust variables that were applied. */
  env: Record<string, string>
  /**
   * Lifetime of the identity token in seconds, as Infisical reported it, or
   * `null` when the token was supplied rather than minted and its expiry is
   * therefore unknown to this client.
   */
  expiresIn: null | number
  /** The proxy route that was applied. */
  route: ProxyRoute
}

/**
 * Client for the [Infisical Agent Proxy](https://infisical.com/docs/documentation/platform/agent-proxy/overview),
 * the commercial successor to Agent Vault.
 *
 * Same bargain, different control plane: the agent holds a machine identity
 * token that can *proxy* but cannot read secrets, and the proxy substitutes
 * the real credential at the network boundary according to the proxied
 * services configured in Infisical.
 *
 * ```typescript
 * import {AgentProxy} from 'sdkck'
 *
 * const proxy = new AgentProxy({address: 'proxy-host:17322'})
 * const {certPath, env} = await proxy.intercept()
 *
 * // From here a plain request is intercepted and the credential injected:
 * await fetch('https://api.github.com/user') // no token in this process
 * ```
 *
 * What this client does *not* do is manage the Infisical side: secrets,
 * proxied services and identity permissions are configured in the dashboard or
 * through the Infisical API. Nor does it run a proxy — point it at one started
 * by `infisical secrets agent-proxy start`.
 */
export class AgentProxy {
  private readonly config: AgentProxyConfig
  private readonly envSource: NodeJS.ProcessEnv
  private fileConfigCache: AgentProxyFileConfig | undefined

  constructor(config?: AgentProxyConfig) {
    this.config = config ?? {}
    this.envSource = this.config.envSource ?? process.env
  }

  /**
   * Persist the root CA certificate and route outbound requests through the
   * Agent Proxy, which attaches the real credential on the way out.
   *
   * The same caveats as Agent Vault's `intercept()` apply: child processes
   * inherit `process.env` unconditionally, but this process's own `fetch` only
   * honours the proxy variables on Node v22.21.0+ and only when they were set
   * before the first request. Pass `env: {}` to build a child environment
   * without touching the current one.
   *
   * @throws {AgentProxyError} when no address or no credential can be
   *   resolved, or when the root CA cannot be read.
   */
  async intercept(options?: AgentProxyInterceptOptions): Promise<AgentProxyInterceptResult> {
    const address = this.resolveAddress()
    const [{expiresIn, token}, caCertificate] = await Promise.all([this.resolveToken(), this.resolveCa()])

    const route = buildAgentProxyRoute({address, caCertificate, token})
    const {certPath, env} = await applyRoute(route, options)

    return {certPath, env, expiresIn, route}
  }

  /** Extra bypass hosts configured for this client, from the env or the config file. */
  resolveNoProxy(): string | undefined {
    return this.envSource[ENV.NO_PROXY] ?? this.fileConfig().noProxy
  }

  /**
   * Read the config file at most once per client, from the config directory
   * `envSource` resolves to — so an injected environment governs *where* the
   * fallback is read from as well as what it falls back from.
   */
  private fileConfig(): AgentProxyFileConfig {
    this.fileConfigCache ??= readAgentProxyFileConfig(resolveConfigDir(this.envSource))
    return this.fileConfigCache
  }

  private resolveAddress(): string {
    const address = this.config.address ?? this.envSource[ENV.ADDRESS] ?? this.fileConfig().address
    if (!address) {
      throw new AgentProxyError(
        `The Agent Proxy address is required. Provide it in the config, set ${ENV.ADDRESS}, ` +
          'or add "address" to <configDir>/agent-proxy.json.',
      )
    }

    return address
  }

  private async resolveCa(): Promise<string> {
    return resolveCaCertificate({
      caPath: this.config.caPath ?? this.envSource[ENV.CA] ?? this.fileConfig().caPath,
      caPem: this.config.caPem,
    })
  }

  private async resolveToken(): Promise<{expiresIn: null | number; token: string}> {
    const token = this.config.token ?? this.envSource[ENV.TOKEN] ?? this.fileConfig().token
    // A supplied token is used as-is: it is already the agent's credential, and
    // logging in again would need a client secret this client may not have.
    if (token) return {expiresIn: null, token}

    const clientId = this.config.clientId ?? this.envSource[ENV.CLIENT_ID] ?? this.fileConfig().clientId
    const clientSecret = this.config.clientSecret ?? this.envSource[ENV.CLIENT_SECRET] ?? this.fileConfig().clientSecret

    if (!clientId || !clientSecret) {
      throw new AgentProxyError(
        `An agent credential is required. Set ${ENV.TOKEN} to a machine identity token, or ` +
          `${ENV.CLIENT_ID} and ${ENV.CLIENT_SECRET} to log in with Universal Auth ` +
          '(or add "token", or "clientId" and "clientSecret", to <configDir>/agent-proxy.json).',
      )
    }

    const identity = await loginUniversalAuth({
      clientId,
      clientSecret,
      domain: this.config.domain ?? this.envSource[ENV.DOMAIN] ?? this.fileConfig().domain,
      fetch: this.config.fetch,
      timeout: this.config.timeout,
    })

    return {expiresIn: identity.expiresIn, token: identity.accessToken}
  }
}
