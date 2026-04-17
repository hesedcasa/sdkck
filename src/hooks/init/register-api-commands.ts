import type {Hook} from '@oclif/core'

import {registerApiCommands} from '../../api-dynamic-commands.js'

/**
 * Reads the api store at startup and registers every imported operation as
 * a first-class oclif command.
 * This makes them visible in `sdkck commands`, `sdkck help`, and
 * `sdkck <specName> <operationId> --help`, exactly like an installed plugin.
 */
const hook: Hook<'init'> = async function (opts) {
  try {
    await registerApiCommands(opts.config)
  } catch {
    // Non-fatal: if the store is unreadable we just don't register the commands.
  }
}

export default hook
