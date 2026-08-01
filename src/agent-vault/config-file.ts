import {existsSync, readFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join} from 'node:path'

import {AgentVaultError} from './errors.js'

/** Config-file fallback for `AGENT_VAULT_TOKEN` / `AGENT_VAULT_ADDR` / `AGENT_VAULT_VAULT`. */
export interface AgentVaultFileConfig {
  address?: string
  token?: string
  vault?: string
}

const CONFIG_FILE_NAME = 'agent-vault.json'
/** Matches oclif's default `Config.dirname` for this CLI: its package name. */
const DIRNAME = 'sdkck'

/**
 * Resolve the sdkck config directory the same way oclif resolves
 * `Config.configDir` for this CLI, without instantiating a full oclif
 * `Config`. This module doubles as a library (`import {AgentVault} from
 * 'sdkck'`), so a real `Config.load()` would resolve relative to the
 * consuming project's nearest package.json rather than sdkck's own.
 */
export function resolveConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SDKCK_CONFIG_DIR) return env.SDKCK_CONFIG_DIR

  // `env.HOME` rather than a bare `homedir()` call, so this stays a pure
  // function of `env` for testing; falls back to the real OS lookup when the
  // passed env omits it, same as the default `process.env` call would want.
  const home = env.HOME || homedir()
  const base = env.XDG_CONFIG_HOME || (process.platform === 'win32' && env.LOCALAPPDATA) || join(home, '.config')
  return join(base, DIRNAME)
}

/**
 * Read `<configDir>/agent-vault.json`, the fallback consulted after explicit
 * config and environment variables for the Agent Vault token, address and
 * vault name.
 *
 * A missing file resolves to `{}` — it is an optional convenience, not a
 * required config surface — but a file that exists and is malformed throws,
 * since silently ignoring a typo would be far more confusing than a clear
 * error pointing at the file.
 *
 * @throws {AgentVaultError} when the file exists but is not a valid JSON
 *   object of string fields.
 */
export function readAgentVaultFileConfig(configDir: string = resolveConfigDir()): AgentVaultFileConfig {
  const path = join(configDir, CONFIG_FILE_NAME)
  if (!existsSync(path)) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new AgentVaultError(`Could not parse ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new AgentVaultError(`${path} must contain a JSON object with optional "token", "address", "vault" fields.`)
  }

  const {address, token, vault} = parsed as Record<string, unknown>
  const result: AgentVaultFileConfig = {}
  for (const [key, value] of Object.entries({address, token, vault})) {
    if (value === undefined) continue
    if (typeof value !== 'string') {
      throw new AgentVaultError(`${path}: "${key}" must be a string.`)
    }

    result[key as keyof AgentVaultFileConfig] = value
  }

  return result
}
