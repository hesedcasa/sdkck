import {readFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join} from 'node:path'

import {AgentProxyError} from './errors.js'

/**
 * Where `infisical secrets agent-proxy connect` leaves the MITM root CA.
 *
 * The Infisical CLI downloads the organization's root CA once and points the
 * standard trust variables at this file; reading it is what lets a client take
 * over the routing without re-implementing the CA distribution endpoint.
 */
export function defaultCaPath(home: string = homedir()): string {
  return join(home, '.infisical', 'agent-proxy', 'mitm-ca.pem')
}

/** Where to get the root CA certificate from. */
export type CaSource = {
  /** Path to a PEM file. Defaults to {@link defaultCaPath}. */
  caPath?: string
  /** Inline PEM. Wins over `caPath` — nothing is read from disk when it is set. */
  caPem?: string
}

/**
 * Resolve the root CA certificate the Agent Proxy's leaf certificates chain to.
 *
 * @throws {AgentProxyError} when the file cannot be read, or does not look like
 *   a PEM certificate — a truncated or half-written CA would otherwise surface
 *   much later as an opaque TLS failure on the first proxied request.
 */
export async function resolveCaCertificate(source?: CaSource): Promise<string> {
  if (source?.caPem) return assertPem(source.caPem, '<inline caPem>')

  const path = source?.caPath ?? defaultCaPath()

  let pem: string
  try {
    pem = await readFile(path, 'utf8')
  } catch (error) {
    const {code} = error as {code?: string}
    const reason =
      code === 'ENOENT'
        ? 'the file does not exist — run `infisical secrets agent-proxy connect` once to download it'
        : (error as Error).message

    throw new AgentProxyError(
      `Could not read the Agent Proxy root CA from ${path}: ${reason}. ` +
        'Set INFISICAL_AGENT_PROXY_CA (or "caPath" in <configDir>/agent-proxy.json) to point at it.',
    )
  }

  return assertPem(pem, path)
}

function assertPem(pem: string, origin: string): string {
  if (!pem.includes('-----BEGIN CERTIFICATE-----')) {
    throw new AgentProxyError(`The Agent Proxy root CA at ${origin} is not a PEM certificate.`)
  }

  return pem
}
