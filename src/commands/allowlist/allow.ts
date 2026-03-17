import {Args, Command} from '@oclif/core'

import {readAllowlistConfig, writeAllowlistConfig} from '../../allowlist-config.js'

export default class AllowlistAllow extends Command {
  static args = {
    pattern: Args.string({
      description:
        'Command pattern to allow. Use a full command ID ("jira issue create"), a topic ("jira"), a topic wildcard ("jira *"), or "*" for everything.',
      required: true,
    }),
  }
  static description = 'Allow a command pattern in the plugin command allowlist'
  static examples = [
    '<%= config.bin %> allowlist allow "*"',
    '<%= config.bin %> allowlist allow jira',
    '<%= config.bin %> allowlist allow "jira *"',
    '<%= config.bin %> allowlist allow "jira issue create"',
  ]

  async run(): Promise<void> {
    const {args} = await this.parse(AllowlistAllow)
    const {pattern} = args

    const config = await readAllowlistConfig(this.config.configDir)

    const exists = config.rules.some((r) => r.pattern === pattern && r.action === 'allow')
    if (exists) {
      this.log(`Pattern "${pattern}" is already in the allow list.`)
      return
    }

    // Remove any conflicting disallow rule for the same pattern
    config.rules = config.rules.filter((r) => !(r.pattern === pattern && r.action === 'disallow'))
    config.rules.push({action: 'allow', pattern})

    await writeAllowlistConfig(this.config.configDir, config)
    this.log(`Added allow rule for pattern "${pattern}".`)
  }
}
