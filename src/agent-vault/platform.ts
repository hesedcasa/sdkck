import {Buffer} from 'node:buffer'
import {createHash} from 'node:crypto'
import {request as httpRequest, type RequestOptions} from 'node:http'
import {request as httpsRequest} from 'node:https'

import type {ContainerConfig} from './resources/mitm.js'

import {AgentVaultError, ApiError} from './errors.js'
import {type AssembleEnvOptions, assembleInterceptedEnv} from './proxy.js'

/** Path on the platform proxy that serves its root CA certificate. */
const CA_PATH = '/_agent-vault/ca'
/** Default CA-fetch timeout, matching the HttpClient convention (30s). */
const DEFAULT_CA_TIMEOUT_MS = 30_000

/** Configuration for the Infisical platform Agent Vault proxy client. */
export type PlatformProxyConfig = {
  /** Optional SHA-256 pin of the proxy CA (`SHA256:<hex>` or bare hex). */
  caFingerprint?: string
  /** Proxy address: `host:17323` or a full `http://`/`https://` URL. */
  proxy: string
  /** The session token (`agv_...`) issued by the dashboard. */
  sessionToken: string
}

/**
 * Parse a proxy address, defaulting the scheme to `http://` — the bare
 * `host:17323` form `infisical agent-vault run --proxy` accepts.
 *
 * @throws {AgentVaultError} on unparseable input, a missing host, or a
 *   scheme other than http/https.
 */
export function normalizeProxyAddress(input: string): URL {
  const trimmed = input.trim()
  const candidate = trimmed.includes('://') ? trimmed : `http://${trimmed}`

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    // WHATWG URL parsing rejects an empty authority outright, so an input like
    // `http://` never reaches the hostname check below — surface the same error.
    const authority = candidate.slice(candidate.indexOf('://') + 3)
    if (authority === '' || /^[/?#]/.test(authority)) {
      throw new AgentVaultError(`"${input}" is not a valid Agent Vault proxy address: the host is missing.`)
    }

    throw new AgentVaultError(`"${input}" is not a valid Agent Vault proxy address.`)
  }

  if (!url.hostname) {
    throw new AgentVaultError(`"${input}" is not a valid Agent Vault proxy address: the host is missing.`)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AgentVaultError(
      `"${input}" is not a valid Agent Vault proxy address: only http and https proxies are supported.`,
    )
  }

  return url
}

/** Extract the certificate string from the `{"certificate": "..."}` envelope. */
function parseCaResponse(body: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new AgentVaultError(`The Agent Vault proxy did not return valid JSON from ${CA_PATH}.`)
  }

  const certificate =
    typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>).certificate : undefined
  if (typeof certificate !== 'string' || certificate.length === 0) {
    throw new AgentVaultError(`The Agent Vault proxy response from ${CA_PATH} has no "certificate" field.`)
  }

  return certificate
}

/**
 * Fetch the platform proxy's root CA from `GET /_agent-vault/ca`.
 *
 * Uses `node:http`/`node:https` rather than `fetch` on purpose: this is a
 * bootstrap request that must reach the proxy directly, while an ambient
 * proxy environment in the surrounding shell (`NODE_USE_ENV_PROXY` plus
 * `HTTPS_PROXY`) would hijack a `fetch` and route the bootstrap through the
 * very proxy whose CA is still being fetched.
 *
 * @throws {ApiError} on a non-2xx answer.
 * @throws {AgentVaultError} on malformed JSON, a missing "certificate" field,
 *   a timeout, or a network error.
 */
export async function fetchProxyCa(address: URL, timeoutMs = DEFAULT_CA_TIMEOUT_MS): Promise<string> {
  const url = new URL(CA_PATH, address)

  return new Promise<string>((resolve, reject) => {
    const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest
    let isSettled = false
    let isTimedOut = false

    const request = requestFn(url, {method: 'GET'} as RequestOptions, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      response.on('end', () => {
        isSettled = true
        clearTimeout(timeoutId)

        const status = response.statusCode ?? 0
        if (status !== 200) {
          reject(
            new ApiError({
              code: 'unknown',
              headers: new Headers(),
              message: `Fetching the Agent Vault proxy CA from ${CA_PATH} failed with status ${status}.`,
              status,
            }),
          )
          return
        }

        try {
          resolve(parseCaResponse(Buffer.concat(chunks).toString('utf8')))
        } catch (error) {
          reject(error instanceof Error ? error : new AgentVaultError(String(error)))
        }
      })
    })

    const timeoutId = setTimeout(() => {
      isTimedOut = true
      request.destroy()
    }, timeoutMs)

    request.on('error', (error: Error) => {
      if (isSettled) return
      isSettled = true
      clearTimeout(timeoutId)

      if (isTimedOut) {
        reject(new AgentVaultError(`Request timed out after ${timeoutMs}ms: GET ${CA_PATH}`))
      } else {
        reject(new AgentVaultError(`Network error contacting the Agent Vault proxy: ${error.message}`))
      }
    })

    request.end()
  })
}

/**
 * SHA-256 fingerprint (uppercase hex) of a PEM certificate's DER body — the
 * form the dashboard displays and `--ca-fingerprint` accepts, modulo the
 * optional `SHA256:` prefix that {@link normalizeFingerprint} strips.
 *
 * @throws {AgentVaultError} when the input is not a PEM certificate.
 */
export function certificateFingerprint(pem: string): string {
  const body = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(pem)?.[1]
  if (!body) {
    throw new AgentVaultError('The Agent Vault proxy CA is not a PEM certificate, so it cannot be pinned.')
  }

  const der = Buffer.from(body.replaceAll(/\s+/g, ''), 'base64')
  return createHash('sha256').update(der).digest('hex').toUpperCase()
}

/** Normalize a configured pin: optional `SHA256:` prefix and any whitespace off, uppercase. */
export function normalizeFingerprint(value: string): string {
  return value.trim().replace(/^sha256:/i, '').replaceAll(/\s+/g, '').toUpperCase()
}

/** Options for {@link PlatformProxy.intercept}. */
export type PlatformInterceptOptions = AssembleEnvOptions & {
  /** CA fetch timeout in milliseconds. Default: 30000. */
  timeoutMs?: number
}

/** What {@link PlatformProxy.intercept} configured. */
export type PlatformInterceptResult = {
  /** Path the root CA certificate was written to. */
  certPath: string
  /** The proxy route that was applied. */
  containerConfig: ContainerConfig
  /** The proxy and CA-trust variables that were applied. */
  env: Record<string, string>
  /** Always `'platform'` — the credential backend that authenticated the proxy. */
  mode: 'platform'
}

/**
 * Build the proxy route for a platform session. The proxy authenticates with
 * HTTP Basic userinfo — username `x-agent-vault`, password = the session
 * token — so the token travels to the proxy on every request; keep the proxy
 * on a private network, as the platform docs warn.
 */
export function buildPlatformContainerConfig(
  address: URL,
  sessionToken: string,
  caCertificate: string,
): ContainerConfig {
  const proxyUrl = `${address.protocol}//x-agent-vault:${encodeURIComponent(sessionToken)}@${address.host}`

  return {
    caCertificate,
    env: {
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl,
      NO_PROXY: `localhost,127.0.0.1,${address.hostname}`,
    },
  }
}

/**
 * Client for one session against an Infisical platform Agent Vault proxy —
 * the SaaS backend (access bundles, time-bound sessions, enrolled proxies on
 * `:17323`), distinct from the self-hosted broker client (`AgentVault`).
 *
 * ```typescript
 * const proxy = new PlatformProxy({proxy: 'proxy.internal:17323', sessionToken: 'agv_...'})
 * const {certPath, env, mode} = await proxy.intercept()
 * // From here a plain request is intercepted and the credential injected:
 * await fetch('https://api.github.com/user') // no token in this process
 * ```
 */
export class PlatformProxy {
  private readonly address: URL
  private readonly caFingerprint?: string
  private readonly sessionToken: string

  constructor(config: PlatformProxyConfig) {
    this.address = normalizeProxyAddress(config.proxy)
    // An empty fingerprint means "no pin" — normalize it away so no code path
    // holds a meaningless pin that merely looks configured.
    this.caFingerprint = config.caFingerprint?.trim() || undefined
    this.sessionToken = config.sessionToken
  }

  /**
   * Fetch the proxy CA — verifying the configured fingerprint pin, when there
   * is one — write it to disk and apply the proxy plus CA-trust variables to
   * the target environment.
   *
   * There is no pre-flight validation of the session on the platform backend:
   * an expired or revoked session surfaces as 403s on the proxied requests
   * themselves (407 would mean the token went missing, 502/503 that the proxy
   * cannot reach Infisical or lost its own access).
   *
   * @throws {AgentVaultError} when the CA cannot be fetched or the fingerprint
   *   pin does not match. Callers fail closed rather than run unbrokered.
   */
  async intercept(options?: PlatformInterceptOptions): Promise<PlatformInterceptResult> {
    const caCertificate = await fetchProxyCa(this.address, options?.timeoutMs)

    if (this.caFingerprint && normalizeFingerprint(this.caFingerprint) !== certificateFingerprint(caCertificate)) {
      throw new AgentVaultError(
        'The Agent Vault proxy CA does not match the configured fingerprint (AGENT_VAULT_CA_FINGERPRINT / caFingerprint), so traffic was not brokered.',
      )
    }

    const containerConfig = buildPlatformContainerConfig(this.address, this.sessionToken, caCertificate)
    const {certPath, env} = await assembleInterceptedEnv(containerConfig, options)

    return {certPath, containerConfig, env, mode: 'platform'}
  }
}
