import {Args, Command} from '@oclif/core'

import {readAllowlistConfig, writeAllowlistConfig} from '../../allowlist-config.js'

export default class AllowlistDisallow extends Command {
  static args = {
    pattern: Args.string({
      description:
        'Command pattern to disallow. Use a full command ID ("jira issue create"), a topic ("jira"), a topic wildcard ("jira *"), or "*" for everything.',
      required: true,
    }),
  }
  static description = 'Disallow a command pattern in the plugin command allowlist'
  static examples = [
    '<%= config.bin %> allowlist disallow "*"',
    '<%= config.bin %> allowlist disallow jira',
    '<%= config.bin %> allowlist disallow "jira *"',
    '<%= config.bin %> allowlist disallow "jira issue create"',
  ]

  async run(): Promise<void> {
    const {args} = await this.parse(AllowlistDisallow)
    const {pattern} = args

    const config = await readAllowlistConfig(this.config.configDir)

    const exists = config.rules.some((r) => r.pattern === pattern && r.action === 'disallow')
    if (exists) {
      this.log(`Pattern "${pattern}" is already in the disallow list.`)
      return
    }

    // Remove any conflicting allow rule for the same pattern
    config.rules = config.rules.filter((r) => !(r.pattern === pattern && r.action === 'allow'))
    config.rules.push({action: 'disallow', pattern})

    await writeAllowlistConfig(this.config.configDir, config)
    this.log(`Added disallow rule for pattern "${pattern}".`)
  }
}
