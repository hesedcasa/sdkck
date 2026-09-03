import type {ProxyRoute} from '../proxy-env.js'

import {AgentProxyError} from './errors.js'

/** Port the Agent Proxy listens on when the address does not name one. */
export const DEFAULT_AGENT_PROXY_PORT = 17_322

/** Inputs for {@link buildAgentProxyRoute}. */
export type AgentProxyRouteOptions = {
  /** Proxy address: `host`, `host:port`, or a full URL. */
  address: string
  /** Root CA certificate PEM the proxy's leaf certificates chain to. */
  caCertificate: string
  /** The agent's machine identity token. */
  token: string
}

/**
 * Normalise an Agent Proxy address into a URL.
 *
 * The documented form is bare — `INFISICAL_AGENT_PROXY_ADDRESS=<proxy-host>:17322`
 * — which `new URL()` would read as a scheme, so a missing scheme is filled in
 * before parsing and a missing port defaults to {@link DEFAULT_AGENT_PROXY_PORT}.
 *
 * @throws {AgentProxyError} when the address cannot be parsed.
 */
export function parseProxyAddress(address: string): URL {
  const trimmed = address.trim()
  if (!trimmed) throw new AgentProxyError('The Agent Proxy address is empty.')

  const withScheme = trimmed.includes('://') ? trimmed : `http://${trimmed}`

  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new AgentProxyError(`Could not parse the Agent Proxy address "${address}".`)
  }

  if (!url.hostname) throw new AgentProxyError(`The Agent Proxy address "${address}" has no host.`)
  url.port ||= String(DEFAULT_AGENT_PROXY_PORT)

  return url
}

/**
 * Build the proxy route an agent's traffic takes through the Agent Proxy.
 *
 * The identity token is carried as URL userinfo, which every HTTP client turns
 * into the `Proxy-Authorization` header the proxy expects on each request —
 * "every proxied request carries the agent's short-lived machine identity
 * token in the proxy-authentication header", and a request without one is
 * refused with a 407. Embedding it in the URL is what makes a plain
 * `HTTPS_PROXY` enough to authenticate, which is how `agent-proxy connect`
 * configures an agent it launches; it mirrors how Agent Vault carries its own
 * session token.
 */
export function buildAgentProxyRoute(options: AgentProxyRouteOptions): ProxyRoute {
  const url = parseProxyAddress(options.address)
  const proxyUrl = `${url.protocol}//${encodeURIComponent(options.token)}@${url.host}`

  return {
    caCertificate: options.caCertificate,
    env: {
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl,
      NO_PROXY: `localhost,127.0.0.1,${url.hostname}`,
    },
  }
}
