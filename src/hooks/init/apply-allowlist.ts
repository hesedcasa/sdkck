import {Hook} from '@oclif/core'

import {matchesPattern, readAllowlistConfig} from '../../allowlist-config.js'

/**
 * Filters config._commands (the internal Map) based on allowlist rules so that
 * disallowed commands are invisible to `sdkck help` and `sdkck commands`.
 *
 * Rule evaluation: first matching rule wins. Commands with no matching rule are
 * allowed by default.
 */
const hook: Hook<'init'> = async function (opts) {
  const allowlistConfig = await readAllowlistConfig(opts.config.configDir)
  if (allowlistConfig.rules.length === 0) return

  const internalCommands = (opts.config as unknown as {_commands: Map<string, unknown>})._commands

  for (const id of internalCommands.keys()) {
    for (const rule of allowlistConfig.rules) {
      if (matchesPattern(id, rule.pattern)) {
        if (rule.action === 'disallow') {
          internalCommands.delete(id)
        }

        break
      }
    }
  }
}

export default hook
