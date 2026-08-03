import {type ChildProcess, spawn} from 'node:child_process'
import {mkdtemp, rm} from 'node:fs/promises'
import {constants, tmpdir} from 'node:os'
import {join} from 'node:path'

import type {AgentVaultFileConfig} from './agent-vault/index.js'

import {AgentVault} from './agent-vault/index.js'

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
export interface InterceptedRunOptions {
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
 * Node reads `NODE_USE_ENV_PROXY` and `NODE_EXTRA_CA_CERTS` when the process
 * starts, so mutating `process.env` in-flight would only cover child processes,
 * not this process's own `fetch` — which is where most commands do their HTTP.
 * Re-executing means the command runs in a process that *started* with the proxy
 * environment, so in-process requests, plugin traffic and any subprocess are all
 * intercepted.
 *
 * The instance-level token is removed from the child's environment: the child
 * only needs the vault-scoped session token, which travels inside the proxy URL.
 *
 * @throws When the session cannot be minted or the certificate cannot be
 *   written. Callers fail closed rather than run unbrokered.
 */
export async function runIntercepted(options: InterceptedRunOptions): Promise<number> {
  const sourceEnv = options.env ?? process.env
  const childEnv: NodeJS.ProcessEnv = {...sourceEnv, [SENTINEL_ENV]: '1'}
  delete childEnv[TOKEN_ENV]

  const agentVault = options.agentVault ?? new AgentVault()
  const certDir = await mkdtemp(join(tmpdir(), 'sdkck-agent-vault-'))

  try {
    await agentVault
      .vault(options.vault)
      .intercept({certPath: join(certDir, 'ca.pem'), env: childEnv, noProxy: options.noProxy})

    return await spawnChild({
      argv: options.argv ?? process.argv.slice(1),
      env: childEnv,
      execArgv: options.execArgv ?? process.execArgv,
      execPath: options.execPath ?? process.execPath,
      spawnFn: options.spawnFn ?? spawn,
    })
  } finally {
    // The child has exited by now, so the certificate is no longer needed.
    await rm(certDir, {force: true, recursive: true})
  }
}

/** Exit code a shell reports for a process killed by a signal. */
function signalExitCode(signal: NodeJS.Signals): number {
  const number = constants.signals[signal as keyof typeof constants.signals]
  return number ? 128 + number : 1
}

/** Run the child with inherited stdio, forwarding termination signals to it. */
async function spawnChild(opts: {
  argv: string[]
  env: NodeJS.ProcessEnv
  execArgv: string[]
  execPath: string
  spawnFn: typeof spawn
}): Promise<number> {
  const child: ChildProcess = opts.spawnFn(opts.execPath, [...opts.execArgv, ...opts.argv], {
    env: opts.env,
    stdio: 'inherit',
  })

  const forward = (signal: NodeJS.Signals) => () => {
    child.kill(signal)
  }

  const onInt = forward('SIGINT')
  const onTerm = forward('SIGTERM')
  process.on('SIGINT', onInt)
  process.on('SIGTERM', onTerm)

  try {
    return await new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => {
        resolve(signal ? signalExitCode(signal) : (code ?? 1))
      })
    })
  } finally {
    process.removeListener('SIGINT', onInt)
    process.removeListener('SIGTERM', onTerm)
  }
}
