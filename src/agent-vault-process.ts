import {type spawn} from 'node:child_process'

import {AgentVault, type AgentVaultFileConfig} from './agent-vault/index.js'
import {runInterceptedProcess} from './intercepted-run.js'

/** Set in the re-executed child so it does not intercept itself again. */
export const SENTINEL_ENV = 'SDKCK_AGENT_VAULT_ACTIVE'
/** Escape hatch: skip interception for one invocation. */
export const DISABLE_ENV = 'SDKCK_AGENT_VAULT_DISABLED'
/** Vault whose credentials the proxy should broker. */
export const VAULT_ENV = 'AGENT_VAULT_VAULT'
/** Extra comma-separated hosts to bypass the proxy for. */
export const NO_PROXY_ENV = 'AGENT_VAULT_NO_PROXY'
/** Instance-level Agent Vault token, used to mint the scoped session. */
export const TOKEN_ENV = 'AGENT_VAULT_TOKEN'
/** Agent Vault management API address. */
export const ADDR_ENV = 'AGENT_VAULT_ADDR'

/** Options for {@link runIntercepted}. Everything is injectable for tests. */
export type InterceptedRunOptions = {
  /** Instance-level client. Defaults to one built from the environment. */
  agentVault?: AgentVault
  /** Arguments for the child, defaulting to this process's (`process.argv.slice(1)`). */
  argv?: string[]
  /** Environment to derive the child's from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
  /** Node options for the child, defaulting to this process's `execArgv`. */
  execArgv?: string[]
  /** Node binary to re-execute. Defaults to `process.execPath`. */
  execPath?: string
  /** Extra comma-separated hosts to bypass the proxy for. See {@link NO_PROXY_ENV}. */
  noProxy?: string
  /** Spawn implementation, for tests. */
  spawnFn?: typeof spawn
  /** Vault name. */
  vault: string
}

/**
 * Whether this invocation should be re-executed with its traffic intercepted,
 * and the vault to broker from.
 *
 * Interception is on whenever an Agent Vault token and a vault name are both
 * available, from the environment or — when the corresponding environment
 * variable is unset — `fileConfig` (the `<configDir>/agent-vault.json`
 * fallback; see `readAgentVaultFileConfig`). It is skipped inside the
 * re-executed child, and when `SDKCK_AGENT_VAULT_DISABLED` is set.
 */
// eslint-disable-next-line unicorn/consistent-boolean-name -- resolves to the vault name, not a boolean
export function shouldIntercept(
  env: NodeJS.ProcessEnv = process.env,
  fileConfig: AgentVaultFileConfig = {},
): string | undefined {
  if (env[SENTINEL_ENV] || env[DISABLE_ENV]) return undefined

  const token = env[TOKEN_ENV] ?? fileConfig.token
  const vault = env[VAULT_ENV] ?? fileConfig.vault
  return token && vault ? vault : undefined
}

/**
 * Re-execute this CLI invocation with every outbound request routed through the
 * Agent Vault proxy, and resolve with the child's exit code.
 *
 * See {@link runInterceptedProcess} for why the command is re-executed rather
 * than intercepted in place.
 *
 * The instance-level token is removed from the child's environment: the child
 * only needs the vault-scoped session token, which travels inside the proxy URL.
 *
 * @throws {Error} When the session cannot be minted or the certificate cannot be
 *   written. Callers fail closed rather than run unbrokered.
 */
export async function runIntercepted(options: InterceptedRunOptions): Promise<number> {
  const agentVault = options.agentVault ?? new AgentVault()

  return runInterceptedProcess({
    argv: options.argv,
    async configure({certPath, env}) {
      await agentVault.vault(options.vault).intercept({certPath, env, noProxy: options.noProxy})
    },
    env: options.env,
    execArgv: options.execArgv,
    execPath: options.execPath,
    sentinels: [SENTINEL_ENV],
    spawnFn: options.spawnFn,
    stripEnv: [TOKEN_ENV],
    tmpPrefix: 'sdkck-agent-vault-',
  })
}
