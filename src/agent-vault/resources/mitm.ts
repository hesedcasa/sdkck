import type {HttpClient} from '../http.js'

import {ApiError} from '../errors.js'

/** MITM proxy port used when the server does not advertise one. */
const DEFAULT_MITM_PORT = 14_322

/**
 * Configuration for routing HTTP(S) traffic through Agent Vault's transparent
 * MITM proxy.
 */
export interface ContainerConfig {
  /** Root CA certificate PEM. Mount it and point the CA trust variables at it. */
  caCertificate: string
  /** Environment variables carrying the proxy route. */
  env: {
    /** Same MITM proxy URL, used for plain `http://` upstreams. */
    HTTP_PROXY: string
    /** MITM proxy URL with the proxy credential embedded. */
    HTTPS_PROXY: string
    /** Hosts that bypass the proxy. */
    NO_PROXY: string
  }
}

/** Where the MITM proxy listens, and the CA that signs its certificates. */
export interface MitmInfo {
  /** Root CA certificate PEM. */
  caCertificate: string
  /** Host the proxy is reachable on, derived from the control-plane address. */
  host: string
  /** Port the server advertises, or {@link DEFAULT_MITM_PORT}. */
  port: number
}

/**
 * Build the proxy route for a token.
 *
 * The proxy authenticates with HTTP Basic, taking the token as the username and
 * the vault as the password — which is why any proxy-capable token works here,
 * whether it was minted as a scoped session or supplied as a long-lived agent
 * token. Mirrors `isolation.BuildProxyEnv` server-side.
 */
export function buildContainerConfig(info: MitmInfo, token: string, vault: string): ContainerConfig {
  const credentials = `${encodeURIComponent(token)}:${encodeURIComponent(vault)}`
  const proxyUrl = `http://${credentials}@${info.host}:${info.port}`

  return {
    caCertificate: info.caCertificate,
    env: {
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl,
      NO_PROXY: `localhost,127.0.0.1,${info.host}`,
    },
  }
}

/**
 * Resource for the MITM proxy's metadata — the root CA plus the host and port
 * it listens on. Needed by both credential paths, so it lives apart from
 * sessions and is shared between them.
 */
export class MitmResource {
  /** Cached info promise — the metadata is static for the server's lifetime. */
  private cache: null | Promise<MitmInfo | null> = null

  constructor(private readonly httpClient: HttpClient) {}

  /**
   * Cached MITM metadata, fetched on first use. `null` when MITM is disabled.
   *
   * Only a positive lookup is cached. A failure clears the slot so the next
   * call retries once the server or the network recovers, and so does a
   * "MITM disabled" answer — a long-lived client must not keep reporting the
   * proxy as off after the server is restarted with MITM enabled.
   */
  info(): Promise<MitmInfo | null> {
    if (!this.cache) {
      const pending = this.fetchInfo()
      this.cache = pending
      const forget = () => {
        if (this.cache === pending) this.cache = null
      }

      pending.then((info) => {
        if (!info) forget()
      }, forget)
    }

    return this.cache
  }

  /**
   * Fetch the CA certificate and the proxy's host/port.
   *
   * @throws {ApiError} when the endpoint fails for any reason other than 404 — a
   *   5xx or an auth failure must not be mistaken for "MITM is off", which would
   *   silently hand back a route whose traffic is never intercepted.
   */
  private async fetchInfo(): Promise<MitmInfo | null> {
    const response = await this.httpClient.raw('GET', '/v1/mitm/ca.pem')
    if (response.status === 404) return null
    if (!response.ok) throw await ApiError.fromResponse(response)

    const caCertificate = await response.text()

    let port = DEFAULT_MITM_PORT
    const portHeader = response.headers.get('X-MITM-Port')
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
}
