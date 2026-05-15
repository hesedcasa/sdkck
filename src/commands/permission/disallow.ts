import {Args, Command} from '@oclif/core'

import {readPermissionConfig, writePermissionConfig} from '../../permission-config.js'

export default class PermissionDisallow extends Command {
  static args = {
    pattern: Args.string({
      description:
        'Command pattern to disallow. Use a full command ID ("jira issue create"), a topic ("jira"), a topic wildcard ("jira *"), or "*" for everything.',
      required: true,
    }),
  }
  static description = 'Disallow a command pattern in the plugin command permission list'
  static examples = [
    '<%= config.bin %> permission disallow "*"',
    '<%= config.bin %> permission disallow jira',
    '<%= config.bin %> permission disallow "jira *"',
    '<%= config.bin %> permission disallow "jira issue create"',
  ]

  async run(): Promise<void> {
    const {args} = await this.parse(PermissionDisallow)
    const {pattern} = args

    const config = await readPermissionConfig(this.config.configDir)

    const exists = config.rules.some((r) => r.pattern === pattern)
    if (exists) {
      this.log(`Pattern "${pattern}" is already in the disallow list.`)
      return
    }

    config.rules.push({pattern})

    await writePermissionConfig(this.config.configDir, config)
    this.log(`Added disallow rule for "${pattern}".`)
  }
}
