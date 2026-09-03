import {type spawn} from 'node:child_process'

import {AGENT_PROXY_ENV, AgentProxy, type AgentProxyFileConfig} from './agent-proxy/index.js'
import {SENTINEL_ENV as AGENT_VAULT_SENTINEL_ENV} from './agent-vault-process.js'
import {runInterceptedProcess} from './intercepted-run.js'

/** Set in the re-executed child so it does not intercept itself again. */
export const SENTINEL_ENV = 'SDKCK_AGENT_PROXY_ACTIVE'
/** Escape hatch: skip interception for one invocation. */
export const DISABLE_ENV = 'SDKCK_AGENT_PROXY_DISABLED'

/**
 * Credentials withheld from the child. The proxy credential rides inside the
 * proxy URL, so the agent needs none of these — and the machine identity secret
 * in particular would let a compromised command mint fresh tokens.
 */
const STRIPPED_ENV = [AGENT_PROXY_ENV.TOKEN, AGENT_PROXY_ENV.CLIENT_ID, AGENT_PROXY_ENV.CLIENT_SECRET]

/** Options for {@link runAgentProxyIntercepted}. Everything is injectable for tests. */
export type AgentProxyRunOptions = {
  /** Client. Defaults to one built from the environment. */
  agentProxy?: AgentProxy
  /** Arguments for the child, defaulting to this process's (`process.argv.slice(1)`). */
  argv?: string[]
  /** Environment to derive the child's from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
  /** Node options for the child, defaulting to this process's `execArgv`. */
  execArgv?: string[]
  /** Node binary to re-execute. Defaults to `process.execPath`. */
  execPath?: string
  /** Extra comma-separated hosts to bypass the proxy for. */
  noProxy?: string
  /** Spawn implementation, for tests. */
  spawnFn?: typeof spawn
}

/**
 * Whether this invocation should be re-executed with its traffic routed
 * through an Infisical Agent Proxy.
 *
 * Interception is on whenever a proxy address and an agent credential — a
 * machine identity token, or the client ID and secret to log in for one — are
 * both available, from the environment or, for whichever variable is unset,
 * `<configDir>/agent-proxy.json`. It is skipped inside the re-executed child,
 * and when `SDKCK_AGENT_PROXY_DISABLED` is set.
 */
export function shouldIntercept(env: NodeJS.ProcessEnv = process.env, fileConfig: AgentProxyFileConfig = {}): boolean {
  if (env[SENTINEL_ENV] || env[DISABLE_ENV]) return false

  const address = env[AGENT_PROXY_ENV.ADDRESS] ?? fileConfig.address
  if (!address) return false

  const token = env[AGENT_PROXY_ENV.TOKEN] ?? fileConfig.token
  const clientId = env[AGENT_PROXY_ENV.CLIENT_ID] ?? fileConfig.clientId
  const clientSecret = env[AGENT_PROXY_ENV.CLIENT_SECRET] ?? fileConfig.clientSecret

  return Boolean(token || (clientId && clientSecret))
}

/**
 * Re-execute this CLI invocation with every outbound request routed through the
 * Agent Proxy, and resolve with the child's exit code.
 *
 * The Agent Vault sentinel is set in the child alongside this broker's own:
 * a single invocation has a single `HTTPS_PROXY`, so letting the child chain a
 * second broker on top would only overwrite this one's route.
 *
 * @throws {Error} When no credential can be resolved, the root CA cannot be
 *   read, or the certificate cannot be written. Callers fail closed rather than
 *   run unbrokered.
 */
export async function runAgentProxyIntercepted(options: AgentProxyRunOptions): Promise<number> {
  const agentProxy = options.agentProxy ?? new AgentProxy()

  return runInterceptedProcess({
    argv: options.argv,
    async configure({certPath, env}) {
      await agentProxy.intercept({certPath, env, noProxy: options.noProxy})
    },
    env: options.env,
    execArgv: options.execArgv,
    execPath: options.execPath,
    sentinels: [SENTINEL_ENV, AGENT_VAULT_SENTINEL_ENV],
    spawnFn: options.spawnFn,
    stripEnv: STRIPPED_ENV,
    tmpPrefix: 'sdkck-agent-proxy-',
  })
}
