import {Errors, Hook} from '@oclif/core'

import {matchesPattern, readAllowlistConfig} from '../../allowlist-config.js'

/**
 * Blocks execution of disallowed commands even when invoked directly by name.
 * This is a safety net: the init hook already hides disallowed commands from
 * listings, but this hook prevents a knowledgeable user from running them anyway.
 *
 * Rule evaluation: first matching rule wins. Commands with no matching rule are
 * allowed by default.
 */
const hook: Hook<'prerun'> = async function ({Command, config}) {
  const allowlistConfig = await readAllowlistConfig(config.configDir)
  if (allowlistConfig.rules.length === 0) return

  for (const rule of allowlistConfig.rules) {
    if (matchesPattern(Command.id, rule.pattern)) {
      if (rule.action === 'disallow') {
        throw new Errors.CLIError(`Command "${Command.id}" is not permitted by the allowlist.`)
      }

      return
    }
  }
}

export default hook
