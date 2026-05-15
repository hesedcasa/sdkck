import {Errors, Hook} from '@oclif/core'

import {matchesPattern, readPermissionConfig} from '../../permission-config.js'

/**
 * Blocks execution of disallowed commands even when invoked directly by name.
 * This is a safety net: the init hook already hides disallowed commands from
 * listings, but this hook prevents a knowledgeable user from running them anyway.
 *
 * Rule evaluation: first matching rule wins. Commands with no matching rule are
 * allowed by default.
 */
const hook: Hook<'prerun'> = async function ({Command, config}) {
  const permissionConfig = await readPermissionConfig(config.configDir)
  if (permissionConfig.rules.length === 0) return

  const normalizedId = Command.id.replaceAll(':', config.topicSeparator)
  for (const rule of permissionConfig.rules) {
    if (matchesPattern(normalizedId, rule.pattern)) {
      throw new Errors.CLIError(`Command "${normalizedId}" is not permitted.`)
    }
  }
}

export default hook
