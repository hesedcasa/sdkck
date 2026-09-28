import {Buffer} from 'node:buffer'
import {createHash} from 'node:crypto'
import {request as httpRequest, type RequestOptions} from 'node:http'
import {request as httpsRequest} from 'node:https'

import {AgentVaultError, ApiError} from './errors.js'

/** Path on the platform proxy that serves its root CA certificate. */
const CA_PATH = '/_agent-vault/ca'
/** Default CA-fetch timeout, matching the HttpClient convention (30s). */
const DEFAULT_CA_TIMEOUT_MS = 30_000

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
