import type {VaultClientConfig} from './types.js'

import {HttpClient} from './http.js'
import {type InterceptOptions, interceptRequests, type InterceptResult} from './proxy.js'
import {SessionsResource} from './resources/sessions.js'

/** Marker distinguishing the internal construction path. */
const INTERNAL = Symbol('VaultClient.internal')

interface InternalArgs {
  httpClient: HttpClient
  marker: typeof INTERNAL
  vaultName: string
}

/**
 * Vault-scoped client. Obtain one from `AgentVault.vault(name)`, or construct
 * it directly with a token and a vault name.
 *
 * ```typescript
 * const vault = new VaultClient({token: 'av_agt_...', vault: 'my-project'})
 * const session = await vault.sessions.create({ttlSeconds: 3600})
 * ```
 */
export class VaultClient {
  /** @internal */
  readonly _httpClient: HttpClient
  /** The vault every request is scoped to. */
  readonly name: string
  /** Sessions resource — mints the vault-scoped tokens the proxy authenticates with. */
  readonly sessions: SessionsResource

  constructor(config: InternalArgs | VaultClientConfig) {
    if ('marker' in config && config.marker === INTERNAL) {
      this._httpClient = config.httpClient
      this.name = config.vaultName
    } else {
      const {vault} = config as VaultClientConfig
      this._httpClient = HttpClient.fromConfig(config as VaultClientConfig).withHeaders({'X-Vault': vault})
      this.name = vault
    }

    this.sessions = new SessionsResource(this._httpClient, this.name)
  }

  /**
   * Used by `AgentVault.vault(name)` with a pre-scoped HTTP client.
   *
   * @internal
   */
  static _create(httpClient: HttpClient, vaultName: string): VaultClient {
    return new VaultClient({httpClient, marker: INTERNAL, vaultName})
  }

  /**
   * Mint a session, persist the root CA certificate and route this process's
   * outbound requests through the Agent Vault proxy, which injects the real
   * credentials on the way out.
   *
   * See {@link interceptRequests} for the details and caveats.
   */
  async intercept(options?: InterceptOptions): Promise<InterceptResult> {
    return interceptRequests(this.sessions, options)
  }
}
