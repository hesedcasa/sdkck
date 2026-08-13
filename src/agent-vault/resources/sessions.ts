import type {HttpClient} from '../http.js'
import type {ScopedSession} from '../types.js'

import {buildContainerConfig, type ContainerConfig, type MitmResource} from './mitm.js'

export type {ContainerConfig} from './mitm.js'

/** Options for minting a vault-scoped session. */
export type CreateSessionOptions = {
  /** Session TTL in seconds (300–604800, i.e. 5 minutes to 7 days). Defaults to the server's 24h. */
  ttlSeconds?: number
}

/** A minted vault-scoped session. */
export type Session = {
  /** Agent Vault server base URL as advertised by the server. */
  address: string
  /** Container configuration for MITM routing. `null` when the server runs with MITM disabled. */
  containerConfig: ContainerConfig | null
  /** ISO 8601 expiration timestamp. */
  expiresAt: string
  /** The vault-scoped session token. */
  token: string
}

/**
 * Expand a {@link ContainerConfig} into the complete env var set for a
 * container, including the CA trust variables honoured by Node.js, Python,
 * curl, Git and Deno.
 *
 * @param config - Container config from a minted session.
 * @param certPath - Path the CA certificate is mounted at inside the container.
 */
export function buildProxyEnv(config: ContainerConfig, certPath: string): Record<string, string> {
  // Keep in sync with augmentEnvWithMITM() in the Agent Vault server (cmd/run.go).
  return {
    CURL_CA_BUNDLE: certPath,
    DENO_CERT: certPath,
    GIT_SSL_CAINFO: certPath,
    HTTP_PROXY: config.env.HTTP_PROXY,
    HTTPS_PROXY: config.env.HTTPS_PROXY,
    NO_PROXY: config.env.NO_PROXY,
    NODE_EXTRA_CA_CERTS: certPath,
    NODE_USE_ENV_PROXY: '1',
    OPENCLAW_PROXY_URL: config.env.HTTPS_PROXY,
    REQUESTS_CA_BUNDLE: certPath,
    SSL_CERT_FILE: certPath,
  }
}

/**
 * Resource for minting vault-scoped session tokens. Maps to `POST /v1/sessions`.
 *
 * Minting requires a `member`-or-better token: the server closes this endpoint
 * to `proxy`-role callers, which "can ONLY proxy requests through Agent Vault".
 * A proxy-role token is already what minting would hand back, so it needs no
 * session — see the agent mode of `interceptRequests`.
 */
export class SessionsResource {
  constructor(
    private readonly httpClient: HttpClient,
    private readonly vaultName: string,
    private readonly mitm: MitmResource,
  ) {}

  /**
   * Mint a vault-scoped session token.
   *
   * The returned session carries a `containerConfig` with the MITM proxy URL,
   * the bypass list and the root CA certificate — hand these to a container
   * runtime so the sandboxed agent's traffic routes through Agent Vault. Use
   * {@link buildProxyEnv} to expand it once the CA mount path is known.
   *
   * `containerConfig` is `null` when the server has MITM disabled.
   *
   * Throws an `ApiError` with status 403 when the token holds only the `proxy`
   * role, which the server refuses to mint from.
   */
  async create(options?: CreateSessionOptions): Promise<Session> {
    const [res, mitmInfo] = await Promise.all([
      this.httpClient.post<ScopedSession>('/v1/sessions', {
        ttl_seconds: options?.ttlSeconds,
        vault: this.vaultName,
      }),
      this.mitm.info(),
    ])

    return {
      address: res.av_addr ?? '',
      containerConfig: mitmInfo ? buildContainerConfig(mitmInfo, res.token, this.vaultName) : null,
      expiresAt: res.expires_at,
      token: res.token,
    }
  }
}
