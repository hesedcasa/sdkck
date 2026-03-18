import {Args, Command} from '@oclif/core'

import {readPermissionConfig, writePermissionConfig} from '../../permission-config.js'

export default class PermissionAllow extends Command {
  static args = {
    pattern: Args.string({
      description:
        'Command pattern to allow. Use a full command ID ("jira issue create"), a topic ("jira"), a topic wildcard ("jira *"), or "*" for everything.',
      required: true,
    }),
  }
  static description = 'Allow a command pattern in the plugin command permission list'
  static examples = [
    '<%= config.bin %> permission allow "*"',
    '<%= config.bin %> permission allow jira',
    '<%= config.bin %> permission allow "jira *"',
    '<%= config.bin %> permission allow "jira issue create"',
  ]

  async run(): Promise<void> {
    const {args} = await this.parse(PermissionAllow)
    const {pattern} = args

    const config = await readPermissionConfig(this.config.configDir)

    const exists = config.rules.some((r) => r.pattern === pattern && r.action === 'allow')
    if (exists) {
      this.log(`Pattern "${pattern}" is already in the allow list.`)
      return
    }

    // Remove any conflicting disallow rule for the same pattern
    config.rules = config.rules.filter((r) => !(r.pattern === pattern && r.action === 'disallow'))
    config.rules.push({action: 'allow', pattern})

    await writePermissionConfig(this.config.configDir, config)
    this.log(`Added allow rule for "${pattern}".`)
  }
}
