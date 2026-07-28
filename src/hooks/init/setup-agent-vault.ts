import {Hook} from '@oclif/core'

import {DISABLE_ENV, runIntercepted, shouldIntercept} from '../../agent-vault-process.js'
import {AgentVaultError} from '../../agent-vault/index.js'

/**
 * Routes every command's outbound traffic through Agent Vault, which injects
 * the real credentials in flight so no command holds a secret.
 *
 * Active whenever `AGENT_VAULT_TOKEN` and `AGENT_VAULT_VAULT` are both set. The
 * work happens by re-executing this invocation with the proxy environment in
 * place — Node reads `NODE_USE_ENV_PROXY` and `NODE_EXTRA_CA_CERTS` at startup,
 * so a process cannot proxy its own `fetch` by mutating `process.env`. This hook
 * therefore supervises: the child does the real work and its exit code is
 * passed straight through.
 *
 * Fails closed. If the session cannot be minted the command does not run,
 * rather than sending requests that bypass the broker.
 */
const hook: Hook<'init'> = async function () {
  const vault = shouldIntercept()
  if (!vault) return

  // Only setup failures are caught here: this.exit() throws, and catching that
  // would turn a clean child run into a spurious "interception failed".
  let exitCode = 1
  try {
    exitCode = await runIntercepted({vault})
  } catch (error) {
    const reason = error instanceof AgentVaultError || error instanceof Error ? error.message : String(error)
    this.error(
      `Agent Vault interception could not be set up for vault "${vault}", so the command was not run: ${reason}\n` +
        `Set ${DISABLE_ENV}=1 to run without brokered credentials.`,
      {exit: 1},
    )
  }

  // The command already ran in the child, so pass its status through verbatim
  // and stop — returning here would let oclif dispatch the command a second
  // time. process.exit is deliberate: this process is only a supervisor, and
  // nothing is buffered because the child inherited its stdio.
  // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit -- CLI supervisor, see above
  process.exit(exitCode)
}

export default hook
