import {AgentVaultError} from '../agent-vault/errors.js'

/**
 * Base error for every Infisical Agent Proxy failure raised locally: missing
 * configuration, an unreadable CA, network problems and request timeouts.
 *
 * Extends {@link AgentVaultError}, which — despite carrying the name of the
 * Agent Vault client that came first — is this package's umbrella type for a
 * credential-broker failure. One `catch (error instanceof AgentVaultError)`
 * therefore covers both brokers and the proxy/certificate layer they share.
 */
export class AgentProxyError extends AgentVaultError {
  constructor(message: string) {
    super(message)
    this.name = 'AgentProxyError'
  }
}

/**
 * Error returned by the Infisical API. Wraps a non-2xx HTTP response with its
 * status and, when the body carries one, the API's own message.
 */
export class AgentProxyApiError extends AgentProxyError {
  readonly status: number

  constructor({message, status}: {message: string; status: number}) {
    super(message)
    this.name = 'AgentProxyApiError'
    this.status = status
  }

  static async fromResponse(response: Response, label: string): Promise<AgentProxyApiError> {
    let detail = response.statusText

    try {
      const body: unknown = await response.json()
      if (typeof body === 'object' && body !== null) {
        const record = body as Record<string, unknown>
        // Infisical returns `{message}`, sometimes alongside `{error}`.
        if (typeof record.message === 'string') detail = record.message
        else if (typeof record.error === 'string') detail = record.error
      }
    } catch {
      // Body was not JSON — keep the status text.
    }

    return new AgentProxyApiError({
      message: `${label} failed with HTTP ${response.status}: ${detail}`,
      status: response.status,
    })
  }
}
