import {AgentProxyApiError, AgentProxyError} from './errors.js'

/** Infisical Cloud (US). Override with `INFISICAL_DOMAIN` for EU or self-hosted. */
export const DEFAULT_INFISICAL_DOMAIN = 'https://app.infisical.com'

/** A machine identity access token, as returned by Universal Auth login. */
export type IdentityToken = {
  /** The bearer token the Agent Proxy authenticates the agent with. */
  accessToken: string
  /** Lifetime in seconds, as reported by the server. */
  expiresIn: number
}

/** Wire format for `POST /api/v1/auth/universal-auth/login`. */
type LoginResponse = {
  accessToken?: string
  expiresIn?: number
}

/** Options for {@link loginUniversalAuth}. */
export type UniversalAuthOptions = {
  clientId: string
  clientSecret: string
  /** Infisical instance base URL. Defaults to {@link DEFAULT_INFISICAL_DOMAIN}. */
  domain?: string
  /** Custom fetch implementation, for tests or non-Node runtimes. */
  fetch?: typeof globalThis.fetch
  /** Request timeout in milliseconds. Default: 30000. */
  timeout?: number
}

const DEFAULT_TIMEOUT = 30_000

/**
 * Exchange a machine identity's client ID and secret for a short-lived access
 * token, via Infisical's Universal Auth login.
 *
 * This is the agent's own identity — the one that holds `Proxy` on the proxied
 * services and, deliberately, no read access to the secrets behind them. The
 * token it yields is what the Agent Proxy authenticates each proxied request
 * with; it is never the credential that reaches the upstream API.
 *
 * @throws {AgentProxyApiError} when Infisical rejects the credentials.
 * @throws {AgentProxyError} on a network failure, a timeout, or a response
 *   without a token.
 */
export async function loginUniversalAuth(options: UniversalAuthOptions): Promise<IdentityToken> {
  const domain = (options.domain ?? DEFAULT_INFISICAL_DOMAIN).replace(/\/+$/, '')
  const url = `${domain}/api/v1/auth/universal-auth/login`
  const fetchFn = options.fetch ?? globalThis.fetch
  const timeout = options.timeout ?? DEFAULT_TIMEOUT

  let response: Response
  try {
    response = await fetchFn(url, {
      body: JSON.stringify({clientId: options.clientId, clientSecret: options.clientSecret}),
      headers: {'Content-Type': 'application/json'},
      method: 'POST',
      signal: timeout > 0 && Number.isFinite(timeout) ? AbortSignal.timeout(timeout) : undefined,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new AgentProxyError(`Request timed out after ${timeout}ms: POST ${url}`)
    }

    throw new AgentProxyError(`Network error: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!response.ok) throw await AgentProxyApiError.fromResponse(response, 'Universal Auth login')

  let body: LoginResponse
  try {
    body = (await response.json()) as LoginResponse
  } catch {
    throw new AgentProxyError(`Universal Auth login returned a non-JSON body from ${url}.`)
  }

  if (!body.accessToken) {
    throw new AgentProxyError(`Universal Auth login succeeded but returned no access token from ${url}.`)
  }

  return {accessToken: body.accessToken, expiresIn: body.expiresIn ?? 0}
}
