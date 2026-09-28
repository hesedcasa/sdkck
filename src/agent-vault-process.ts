import {type ChildProcess, spawn} from 'node:child_process'
import {mkdtemp, rm} from 'node:fs/promises'
import {constants, tmpdir} from 'node:os'
import {join} from 'node:path'

import {AgentVault, AgentVaultError, type AgentVaultFileConfig, PlatformProxy} from './agent-vault/index.js'

/** Set in the re-executed child so it does not intercept itself again. */
export const SENTINEL_ENV = 'SDKCK_AGENT_VAULT_ACTIVE'
/** Escape hatch: skip interception for one invocation. */
export const DISABLE_ENV = 'SDKCK_AGENT_VAULT_DISABLED'
/** Vault whose credentials the OSS broker should proxy. */
export const VAULT_ENV = 'AGENT_VAULT_VAULT'
/** Extra comma-separated hosts to bypass the proxy for. */
export const NO_PROXY_ENV = 'AGENT_VAULT_NO_PROXY'
/** OSS-broker instance token, used to mint the scoped session. */
export const TOKEN_ENV = 'AGENT_VAULT_TOKEN'
/** OSS-broker management API address. */
export const ADDR_ENV = 'AGENT_VAULT_ADDR'
/** Infisical platform Agent Vault session token (`agv_...`). */
export const SESSION_TOKEN_ENV = 'AGENT_VAULT_SESSION_TOKEN'
/** Infisical platform Agent Vault proxy address. */
export const PROXY_ENV = 'AGENT_VAULT_PROXY'
/** Optional SHA-256 pin of the platform proxy CA. */
export const CA_FINGERPRINT_ENV = 'AGENT_VAULT_CA_FINGERPRINT'

/** The self-hosted OSS broker credential path. */
export type BrokerTarget = {kind: 'broker'; vault: string}
/** The Infisical SaaS platform proxy credential path. */
export type PlatformTarget = {caFingerprint?: string; kind: 'platform'; proxy: string; sessionToken: string}
/** Which backend an intercepted invocation runs under. */
export type InterceptTarget = BrokerTarget | PlatformTarget

/**
 * Whether this invocation should be re-executed with its traffic intercepted,
 * and through which backend.
 *
 * Two backends share the machinery, auto-detected from which config fields
 * are present — tokens stay opaque, there is no prefix sniffing:
 *
 * - **platform** — the Infisical SaaS Agent Vault. Selected as soon as either
 *   platform field (`AGENT_VAULT_SESSION_TOKEN` / `AGENT_VAULT_PROXY`, from
 *   the environment or, for whichever is unset, `fileConfig`) is present; both
 *   are required, so a lone field throws rather than half-configuring. The
 *   optional CA pin rides along.
 * - **broker** — the self-hosted OSS broker, exactly as before:
 *   `AGENT_VAULT_TOKEN` plus `AGENT_VAULT_VAULT`, both or nothing.
 *
 * When both backends are fully configured the platform backend wins — a
 * documented resolution order, like env-over-file. Skipped inside the
 * re-executed child, and when `SDKCK_AGENT_VAULT_DISABLED` is set.
 *
 * @throws {AgentVaultError} when platform fields are present but incomplete.
 */
// eslint-disable-next-line unicorn/consistent-boolean-name -- resolves to the backend to intercept with, not a boolean
export function shouldIntercept(
  env: NodeJS.ProcessEnv = process.env,
  fileConfig: AgentVaultFileConfig = {},
): InterceptTarget | undefined {
  if (env[SENTINEL_ENV] || env[DISABLE_ENV]) return undefined

  // An empty value (e.g. `AGENT_VAULT_CA_FINGERPRINT=${PIN:-}`) means unset, so
  // it falls through to the file-config pin instead of shadowing it.
  const envCaFingerprint = env[CA_FINGERPRINT_ENV]?.trim() || undefined
  const sessionToken = env[SESSION_TOKEN_ENV] ?? fileConfig.sessionToken
  const proxy = env[PROXY_ENV] ?? fileConfig.proxy
  if (sessionToken !== undefined || proxy !== undefined) {
    if (!sessionToken || !proxy) {
      throw new AgentVaultError(
        sessionToken
          ? `${PROXY_ENV} (or "proxy" in <configDir>/agent-vault.json) is required alongside ${SESSION_TOKEN_ENV}.`
          : `${SESSION_TOKEN_ENV} (or "sessionToken" in <configDir>/agent-vault.json) is required alongside ${PROXY_ENV}.`,
      )
    }

    return {
      caFingerprint: envCaFingerprint ?? fileConfig.caFingerprint,
      kind: 'platform',
      proxy,
      sessionToken,
    }
  }

  const token = env[TOKEN_ENV] ?? fileConfig.token
  const vault = env[VAULT_ENV] ?? fileConfig.vault
  return token && vault ? {kind: 'broker', vault} : undefined
}

/** Options for {@link runIntercepted}. Everything is injectable for tests. */
export type InterceptedRunOptions = {
  /** Broker client, for the broker target. Defaults to one built from the environment. */
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
  /** Platform proxy client, for the platform target. Defaults to one built from the target. */
  platformProxy?: PlatformProxy
  /** Spawn implementation, for tests. */
  spawnFn?: typeof spawn
  /** Which backend to intercept with — resolved by {@link shouldIntercept}. */
  target: InterceptTarget
}

/**
 * Re-execute this CLI invocation with every outbound request routed through
 * the resolved backend's proxy, and resolve with the child's exit code.
 *
 * Node reads `NODE_USE_ENV_PROXY` and `NODE_EXTRA_CA_CERTS` when the process
 * starts, so mutating `process.env` in-flight would only cover child processes,
 * not this process's own `fetch` — which is where most commands do their HTTP.
 * Re-executing means the command runs in a process that *started* with the proxy
 * environment, so in-process requests, plugin traffic and any subprocess are all
 * intercepted.
 *
 * The parent's credential material is withheld from the child: for both
 * backends the proxy credential rides inside the proxy URL instead, and the
 * sentinel already stops the child from intercepting itself.
 *
 * @throws {Error} When the proxy route cannot be set up. Callers fail closed
 *   rather than run unbrokered.
 */
export async function runIntercepted(options: InterceptedRunOptions): Promise<number> {
  const sourceEnv = options.env ?? process.env
  const childEnv: NodeJS.ProcessEnv = {...sourceEnv, [SENTINEL_ENV]: '1'}
  for (const key of [TOKEN_ENV, SESSION_TOKEN_ENV, PROXY_ENV, CA_FINGERPRINT_ENV]) {
    Reflect.deleteProperty(childEnv, key)
  }

  const certDir = await mkdtemp(join(tmpdir(), 'sdkck-agent-vault-'))

  try {
    if (options.target.kind === 'broker') {
      const agentVault = options.agentVault ?? new AgentVault()
      await agentVault
        .vault(options.target.vault)
        .intercept({certPath: join(certDir, 'ca.pem'), env: childEnv, noProxy: options.noProxy})
    } else {
      const platformProxy =
        options.platformProxy ??
        new PlatformProxy({
          caFingerprint: options.target.caFingerprint,
          proxy: options.target.proxy,
          sessionToken: options.target.sessionToken,
        })
      await platformProxy.intercept({certPath: join(certDir, 'ca.pem'), env: childEnv, noProxy: options.noProxy})
    }

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
  const number = constants.signals[signal]
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
