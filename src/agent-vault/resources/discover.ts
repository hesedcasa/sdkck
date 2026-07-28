import type {HttpClient} from '../http.js'

import {AgentVaultError, ApiError} from '../errors.js'

/** A service the vault brokers credentials for. */
export interface DiscoveredService {
  /** Host the rule matches, optionally with a port and path glob. */
  host: string
  /** Rule name. */
  name: string
}

/** What a token can reach, as reported by `GET /discover`. */
export interface Discovery {
  /** Credential keys stored in the vault. Values are never returned. */
  availableCredentials: string[]
  /** Service rules the proxy will inject credentials for. */
  services: DiscoveredService[]
  /** Vault the token resolves to. */
  vault: string
}

/** Wire format for `GET /discover` — snake_case, as the server returns it. */
interface DiscoveryWire {
  available_credentials?: string[]
  services?: DiscoveredService[]
  vault?: string
}

/**
 * Resource for `GET /discover`, the endpoint that reports which services and
 * credential keys a token can reach.
 *
 * This is how a proxy-role token is checked before anything is routed through
 * it. Minting a session (`POST /v1/sessions`) is deliberately closed to such
 * tokens server-side — a `proxy`-role caller "can ONLY proxy requests through
 * Agent Vault" — so `/discover` is the only validation available, and is what
 * the official `agent-vault run` uses in its agent mode.
 */
export class DiscoverResource {
  constructor(
    private readonly httpClient: HttpClient,
    private readonly vaultName: string,
  ) {}

  /**
   * Confirm the token is accepted by the broker and scoped to this vault.
   *
   * Validating up front means a bad token fails once at startup rather than
   * turning every proxied request into a 401.
   *
   * @throws {AgentVaultError} when the broker rejects the token (401/403), or
   *   when the token is scoped to a different vault than the one requested.
   * @throws {ApiError} for any other non-2xx response.
   */
  async validate(): Promise<Discovery> {
    const response = await this.httpClient.raw('GET', '/discover')

    if (response.status === 401 || response.status === 403) {
      throw new AgentVaultError(
        `Agent Vault rejected the token (HTTP ${response.status}) — check it is current and has access to vault "${this.vaultName}".`,
      )
    }

    if (!response.ok) throw await ApiError.fromResponse(response)

    const body = (await response.json()) as DiscoveryWire

    // A vault-scoped token carries its own vault; a mismatch means the caller
    // asked for credentials the token will never broker.
    if (body.vault && body.vault !== this.vaultName) {
      throw new AgentVaultError(
        `Vault mismatch: requested vault "${this.vaultName}" but the token is scoped to "${body.vault}".`,
      )
    }

    return {
      availableCredentials: body.available_credentials ?? [],
      services: body.services ?? [],
      vault: body.vault ?? this.vaultName,
    }
  }
}
