import {type Hook} from '@oclif/core'

import {DISABLE_ENV, runAgentProxyIntercepted, SENTINEL_ENV, shouldIntercept} from '../../agent-proxy-process.js'
import {AGENT_PROXY_ENV, AgentProxy, AgentProxyError, readAgentProxyFileConfig} from '../../agent-proxy/index.js'

/**
 * Routes every command's outbound traffic through an Infisical Agent Proxy,
 * which attaches the real credentials in flight so no command holds a secret.
 *
 * Active whenever a proxy address and an agent credential are both available —
 * from `INFISICAL_AGENT_PROXY_ADDRESS` plus either `INFISICAL_TOKEN` or the
 * `INFISICAL_UNIVERSAL_AUTH_CLIENT_ID`/`_SECRET` pair, or, for whichever of
 * those is unset, `<configDir>/agent-proxy.json`. The work happens by
 * re-executing this invocation with the proxy environment in place — Node reads
 * `NODE_USE_ENV_PROXY` and `NODE_EXTRA_CA_CERTS` at startup, so a process
 * cannot proxy its own `fetch` by mutating `process.env`. This hook therefore
 * supervises: the child does the real work and its exit code is passed
 * straight through.
 *
 * Registered ahead of `setup-agent-vault`, so an invocation configured for both
 * brokers takes the Agent Proxy — it is the supported successor to Agent Vault,
 * and only one of them can own `HTTPS_PROXY`.
 *
 * Fails closed. If no credential can be resolved, or the root CA cannot be
 * read, the command does not run rather than sending requests that bypass the
 * proxy.
 *
 * `INFISICAL_AGENT_PROXY_NO_PROXY` (or `noProxy` in the config file) adds hosts
 * that bypass the proxy entirely, for internal destinations it was never meant
 * to broker.
 */
const hook: Hook<'init'> = async function () {
  // Bypass checks come first and never touch the config file: a malformed,
  // unrelated agent-proxy.json must not block the disable escape hatch, nor
  // break the re-executed child (which hits this hook again with the
  // sentinel set).
  if (process.env[SENTINEL_ENV] || process.env[DISABLE_ENV]) return

  // Read once against the real configDir, so the decision made here and the
  // credentials the child is set up with can never disagree about which config
  // file backed them.
  const fileConfig = readAgentProxyFileConfig(this.config.configDir)
  if (!shouldIntercept(process.env, fileConfig)) return

  // Only setup failures are caught here: this.exit() throws, and catching that
  // would turn a clean child run into a spurious "interception failed".
  let exitCode = 1
  try {
    const agentProxy = new AgentProxy({
      address: process.env[AGENT_PROXY_ENV.ADDRESS] ?? fileConfig.address,
      caPath: process.env[AGENT_PROXY_ENV.CA] ?? fileConfig.caPath,
      clientId: process.env[AGENT_PROXY_ENV.CLIENT_ID] ?? fileConfig.clientId,
      clientSecret: process.env[AGENT_PROXY_ENV.CLIENT_SECRET] ?? fileConfig.clientSecret,
      domain: process.env[AGENT_PROXY_ENV.DOMAIN] ?? fileConfig.domain,
      token: process.env[AGENT_PROXY_ENV.TOKEN] ?? fileConfig.token,
    })
    const noProxy = process.env[AGENT_PROXY_ENV.NO_PROXY] ?? fileConfig.noProxy
    exitCode = await runAgentProxyIntercepted({agentProxy, noProxy})
  } catch (error) {
    const reason = error instanceof AgentProxyError || error instanceof Error ? error.message : String(error)
    this.error(
      `Agent Proxy interception could not be set up, so the command was not run: ${reason}\n` +
        `Set ${DISABLE_ENV}=1 to run without brokered credentials.`,
      {exit: 1},
    )
  }

  // The command already ran in the child, so pass its status through verbatim
  // and stop — returning here would let oclif dispatch the command a second
  // time. process.exit is deliberate: this process is only a supervisor, and
  // nothing is buffered because the child inherited its stdio.
  // eslint-disable-next-line unicorn/no-process-exit -- CLI supervisor, see above
  process.exit(exitCode)
}

export default hook
