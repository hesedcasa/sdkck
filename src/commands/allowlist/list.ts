import {Command} from '@oclif/core'

import {readAllowlistConfig} from '../../allowlist-config.js'

export default class AllowlistList extends Command {
  static description = 'List all rules in the plugin command allowlist'
  static examples = ['<%= config.bin %> allowlist list']

  async run(): Promise<void> {
    const config = await readAllowlistConfig(this.config.configDir)

    if (config.rules.length === 0) {
      this.log('No allowlist rules configured.')
      return
    }

    this.log(`${config.rules.length} rule${config.rules.length === 1 ? '' : 's'}:\n`)

    for (const rule of config.rules) {
      const indicator = rule.action === 'allow' ? '✓ allow   ' : '✗ disallow'
      this.log(`  ${indicator}  ${rule.pattern}`)
    }
  }
}
