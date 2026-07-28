import type {AgentVaultConfig} from './types.js'

import {HttpClient} from './http.js'
import {VaultClient} from './vault.js'

/**
 * Instance-level Agent Vault client.
 *
 * Use it with an instance-level agent token (`av_agt_...`), which can reach
 * every vault the token is entitled to.
 *
 * ```typescript
 * // Resolve token and address from AGENT_VAULT_TOKEN / AGENT_VAULT_ADDR
 * const av = new AgentVault()
 *
 * // Or configure explicitly
 * const av = new AgentVault({address: 'http://localhost:14321', token: 'av_agt_...'})
 *
 * const {env} = await av.vault('my-project').intercept()
 * ```
 */
export class AgentVault {
  /** @internal */
  readonly _httpClient: HttpClient

  constructor(config?: AgentVaultConfig) {
    this._httpClient = HttpClient.fromConfig(config)
  }

  /**
   * A {@link VaultClient} scoped to the named vault.
   *
   * The `X-Vault` header is injected on every request so an instance-level
   * token lands on the right vault.
   */
  vault(name: string): VaultClient {
    return VaultClient._create(this._httpClient.withHeaders({'X-Vault': name}), name)
  }
}
