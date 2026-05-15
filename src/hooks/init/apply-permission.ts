import {Errors, Hook} from '@oclif/core'

import {isCommandAllowed, readPermissionConfig} from '../../permission-config.js'

/**
 * Hides disallowed commands from `sdkck help` and `sdkck commands` by setting
 * hidden=true on the command object, and blocks invocation (including --help)
 * by throwing a CLIError when the current command id is disallowed.
 *
 * Throwing here covers both normal runs and --help, since oclif checks for
 * --help after the init hook returns.
 *
 * Rule evaluation: first matching rule wins. Commands with no matching rule are
 * allowed by default.
 */
const hook: Hook<'init'> = async function (opts) {
  const permissionConfig = await readPermissionConfig(opts.config.configDir)
  if (permissionConfig.rules.length === 0) return

  const internalCommands = (opts.config as unknown as {_commands: Map<string, {hidden: boolean}>})._commands
  const internalTopics = (opts.config as unknown as {_topics: Map<string, {hidden: boolean}>})._topics

  // Normalise the invoked command id to the configured topic separator so it
  // can be compared with user-defined patterns (which use spaces).
  // When the user runs `help <target>`, opts.id is 'help' and opts.argv holds
  // the target tokens — reconstruct the target id for permission checking.
  const rawId =
    opts.id === 'help' && opts.argv.length > 0
      ? opts.argv.filter((a) => !a.startsWith('-')).join(opts.config.topicSeparator)
      : opts.id
  const invokedId = rawId?.replaceAll(':', opts.config.topicSeparator)

  for (const [id, command] of internalCommands) {
    const normalizedId = id.replaceAll(':', opts.config.topicSeparator)
    if (!isCommandAllowed(normalizedId, permissionConfig)) {
      command.hidden = true
    }
  }

  for (const [id, topic] of internalTopics) {
    const normalizedId = id.replaceAll(':', opts.config.topicSeparator)
    if (!isCommandAllowed(normalizedId, permissionConfig)) {
      topic.hidden = true
    }
  }

  // Block invocation (including --help) of a disallowed command before oclif
  // reaches its --help display or runCommand path. Print the message directly
  // and use Errors.exit() so oclif's debug-mode error handler never sees it
  // (which would dump a noisy stack trace).
  if (invokedId && !isCommandAllowed(invokedId, permissionConfig)) {
    process.stderr.write(`Command "${invokedId}" is not permitted.\n`)
    Errors.exit(2)
  }
}

export default hook
