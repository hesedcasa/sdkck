/**
 * Shared configuration for the Agent Vault clients.
 *
 * Token and address resolve in order: explicit config > environment variable >
 * default (and the token throws when nothing supplies it).
 */
export interface ClientConfig {
  /** Agent Vault server base URL. Falls back to `AGENT_VAULT_ADDR`, then `http://localhost:14321`. */
  address?: string
  /** Custom fetch implementation, for tests or non-Node runtimes. */
  fetch?: typeof globalThis.fetch
  /** Extra headers sent on every request. */
  headers?: Record<string, string>
  /** Request timeout in milliseconds. Default: 30000. */
  timeout?: number
  /** Authentication token. Falls back to the `AGENT_VAULT_TOKEN` environment variable. */
  token?: string
}

/** Configuration for the instance-level client. */
export type AgentVaultConfig = ClientConfig

/** Configuration for the vault-scoped client, which also needs the vault name. */
export type VaultClientConfig = ClientConfig & {
  /** Vault to scope every request to. */
  vault: string
}

/** Wire format for `POST /v1/sessions` — snake_case, as the server returns it. */
export interface ScopedSession {
  av_addr?: string
  expires_at: string
  token: string
}
