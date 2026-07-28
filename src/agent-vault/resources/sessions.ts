import type {HttpClient} from '../http.js'
import type {ScopedSession} from '../types.js'

import {ApiError} from '../errors.js'

/** Options for minting a vault-scoped session. */
export interface CreateSessionOptions {
  /** Session TTL in seconds (300–604800, i.e. 5 minutes to 7 days). Defaults to the server's 24h. */
  ttlSeconds?: number
}

/**
 * Configuration for routing a sandboxed agent's HTTP(S) traffic through Agent
 * Vault's transparent MITM proxy.
 */
export interface ContainerConfig {
  /** Root CA certificate PEM. Mount it into the container and point the CA trust variables at it. */
  caCertificate: string
  /** Environment variables to inject into the container. */
  env: {
    /** Same MITM proxy URL, used for plain `http://` upstreams. */
    HTTP_PROXY: string
    /** MITM proxy URL with the scoped token embedded. */
    HTTPS_PROXY: string
    /** Hosts that bypass the proxy. */
    NO_PROXY: string
  }
}

/** A minted vault-scoped session. */
export interface Session {
  /** Agent Vault server base URL as advertised by the server. */
  address: string
  /** Container configuration for MITM routing. `null` when the server runs with MITM disabled. */
  containerConfig: ContainerConfig | null
  /** ISO 8601 expiration timestamp. */
  expiresAt: string
  /** The vault-scoped session token. */
  token: string
}

/** MITM proxy port used when the server does not advertise one. */
const DEFAULT_MITM_PORT = 14_322

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

/** Cached MITM metadata — static for the server's lifetime. */
interface MitmInfo {
  caCertificate: string
  host: string
  port: number
}

/**
 * Resource for minting vault-scoped session tokens. Maps to `POST /v1/sessions`.
 */
export class SessionsResource {
  /** Cached MITM info promise — fetched once, reused across `create()` calls. */
  private mitmInfoCache: null | Promise<MitmInfo | null> = null

  constructor(
    private readonly httpClient: HttpClient,
    private readonly vaultName: string,
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
   */
  async create(options?: CreateSessionOptions): Promise<Session> {
    const [res, mitmInfo] = await Promise.all([
      this.httpClient.post<ScopedSession>('/v1/sessions', {
        // eslint-disable-next-line camelcase -- wire field name
        ttl_seconds: options?.ttlSeconds,
        vault: this.vaultName,
      }),
      this.getMitmInfo(),
    ])

    let containerConfig: ContainerConfig | null = null
    if (mitmInfo) {
      const credentials = `${encodeURIComponent(res.token)}:${encodeURIComponent(this.vaultName)}`
      const proxyUrl = `http://${credentials}@${mitmInfo.host}:${mitmInfo.port}`
      containerConfig = {
        caCertificate: mitmInfo.caCertificate,
        env: {
          HTTP_PROXY: proxyUrl,
          HTTPS_PROXY: proxyUrl,
          NO_PROXY: `localhost,127.0.0.1,${mitmInfo.host}`,
        },
      }
    }

    return {
      address: res.av_addr ?? '',
      containerConfig,
      expiresAt: res.expires_at,
      token: res.token,
    }
  }

  /**
   * Fetch the MITM CA certificate and its host/port metadata.
   * Returns `null` when MITM is disabled on the server.
   *
   * @throws {ApiError} when the endpoint fails for any other reason — a 5xx or
   *   an auth failure must not be mistaken for "MITM is off", which would
   *   silently hand back a session whose traffic is never intercepted.
   */
  private async fetchMitmInfo(): Promise<MitmInfo | null> {
    const resp = await this.httpClient.raw('GET', '/v1/mitm/ca.pem')
    if (resp.status === 404) return null
    if (!resp.ok) throw await ApiError.fromResponse(resp)

    const caCertificate = await resp.text()

    let port = DEFAULT_MITM_PORT
    const portHeader = resp.headers.get('X-MITM-Port')
    if (portHeader) {
      const parsed = Number.parseInt(portHeader, 10)
      if (parsed > 0 && parsed < 65_536) port = parsed
    }

    let host = '127.0.0.1'
    try {
      const {hostname} = new URL(this.httpClient.getBaseUrl())
      if (hostname) host = hostname
    } catch {
      // Unparseable base URL — fall back to loopback.
    }

    return {caCertificate, host, port}
  }

  /**
   * Cached MITM info, fetched on first use.
   *
   * Only a positive lookup is cached. A failure clears the slot so the next
   * `create()` retries once the server or the network recovers, and so does a
   * "MITM disabled" answer — a long-lived client must not keep reporting the
   * proxy as off after the server is restarted with MITM enabled.
   */
  private getMitmInfo(): Promise<MitmInfo | null> {
    if (!this.mitmInfoCache) {
      const pending = this.fetchMitmInfo()
      this.mitmInfoCache = pending
      const forget = () => {
        if (this.mitmInfoCache === pending) this.mitmInfoCache = null
      }

      pending.then((info) => {
        if (!info) forget()
      }, forget)
    }

    return this.mitmInfoCache
  }
}
