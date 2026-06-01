import {Command} from '@oclif/core'

import {readPermissionConfig} from '../../permission-config.js'

export default class PermissionList extends Command {
  static description = 'List all rules in the plugin command permission list'
  static examples = ['<%= config.bin %> permission list']

  async run(): Promise<void> {
    await this.parse(PermissionList)
    const config = await readPermissionConfig(this.config.configDir)

    if (config.rules.length === 0) {
      this.log('No permission rules configured.')
      return
    }

    this.log(`${config.rules.length} rule${config.rules.length === 1 ? '' : 's'}:\n`)

    for (const rule of config.rules) {
      this.log(`  ✗ disallow  ${rule.pattern}`)
    }
  }
}
