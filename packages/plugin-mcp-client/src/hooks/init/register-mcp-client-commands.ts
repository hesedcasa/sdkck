import type {Hook} from '@oclif/core'

import {registerMcpClientCommands} from '../../mcp-client-commands.js'

/**
 * Reads the mcp-client store at startup and registers every cached MCP tool as
 * a first-class oclif command under `<serverName> <toolName>`.
 * Tools are discovered when `mcp client add` or `mcp client refresh` is run.
 */
const hook: Hook<'init'> = async function (opts) {
  try {
    await registerMcpClientCommands(opts.config)
  } catch {
    // Non-fatal: if the store is unreadable we just don't register the commands.
  }
}

export default hook
