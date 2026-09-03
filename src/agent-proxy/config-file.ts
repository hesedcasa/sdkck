import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'

import {resolveConfigDir} from '../agent-vault/config-file.js'
import {AgentProxyError} from './errors.js'

/**
 * Config-file fallback for the `INFISICAL_*` environment variables the Agent
 * Proxy client reads. Every field is optional and every field is a string.
 */
export type AgentProxyFileConfig = {
  /** Fallback for `INFISICAL_AGENT_PROXY_ADDRESS` — `host[:port]` or a full URL. */
  address?: string
  /** Fallback for `INFISICAL_AGENT_PROXY_CA` — path to the MITM root CA PEM. */
  caPath?: string
  /** Fallback for `INFISICAL_UNIVERSAL_AUTH_CLIENT_ID`. */
  clientId?: string
  /** Fallback for `INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET`. */
  clientSecret?: string
  /** Fallback for `INFISICAL_DOMAIN` — the Infisical instance to authenticate against. */
  domain?: string
  /**
   * Comma-separated hosts to bypass the proxy for, fallback for
   * `INFISICAL_AGENT_PROXY_NO_PROXY`. Merged into `NO_PROXY` alongside the
   * proxy's own entries (`localhost`, `127.0.0.1`, its host).
   */
  noProxy?: string
  /**
   * Fallback for `INFISICAL_TOKEN` — a pre-issued machine identity token,
   * used as-is instead of logging in with a client ID and secret.
   */
  token?: string
}

const CONFIG_FILE_NAME = 'agent-proxy.json'

const FIELDS = ['address', 'caPath', 'clientId', 'clientSecret', 'domain', 'noProxy', 'token'] as const

/**
 * Read `<configDir>/agent-proxy.json`, the fallback consulted after explicit
 * config and environment variables.
 *
 * A missing file resolves to `{}` — it is an optional convenience, not a
 * required config surface — but a file that exists and is malformed throws,
 * since silently ignoring a typo would be far more confusing than a clear
 * error pointing at the file. Mirrors `readAgentVaultFileConfig`.
 *
 * @throws {AgentProxyError} when the file exists but is not a valid JSON
 *   object of string fields.
 */
export function readAgentProxyFileConfig(configDir: string = resolveConfigDir()): AgentProxyFileConfig {
  const path = join(configDir, CONFIG_FILE_NAME)
  if (!existsSync(path)) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new AgentProxyError(`Could not parse ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new AgentProxyError(
      `${path} must contain a JSON object with optional ${FIELDS.map((field) => `"${field}"`).join(', ')} fields.`,
    )
  }

  const record = parsed as Record<string, unknown>
  const result: AgentProxyFileConfig = {}
  for (const key of FIELDS) {
    const value = record[key]
    if (value === undefined) continue
    if (typeof value !== 'string') {
      throw new AgentProxyError(`${path}: "${key}" must be a string.`)
    }

    result[key] = value
  }

  return result
}
