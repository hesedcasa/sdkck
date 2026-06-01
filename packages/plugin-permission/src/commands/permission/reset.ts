import {Command, Flags} from '@oclif/core'
import * as readline from 'node:readline'

import {readPermissionConfig, writePermissionConfig} from '../../permission-config.js'

export default class PermissionReset extends Command {
  static description = 'Reset all plugin command permission rules'
  static examples = ['<%= config.bin %> permission reset', '<%= config.bin %> permission reset --confirm']
  static flags = {
    confirm: Flags.boolean({
      description: 'Skip the confirmation prompt',
      required: false,
    }),
  }
  // Exposed for testing — inject a mock to skip real stdin interaction
  _prompt: (message: string) => Promise<string> = (message) =>
    new Promise((resolve) => {
      const rl = readline.createInterface({input: process.stdin, output: process.stdout})
      rl.question(`${message}: `, (answer) => {
        rl.close()
        resolve(answer)
      })
    })

  async run(): Promise<void> {
    const {flags} = await this.parse(PermissionReset)

    const config = await readPermissionConfig(this.config.configDir)
    if (config.rules.length === 0) {
      this.log('No permission rules to reset.')
      return
    }

    if (!flags.confirm) {
      const answer = await this._prompt('This will remove all permission rules. Type "yes" to confirm')
      if (answer.toLowerCase() !== 'yes') {
        this.log('Reset cancelled.')
        return
      }
    }

    await writePermissionConfig(this.config.configDir, {rules: []})
    this.log('All permission rules have been removed.')
  }
}
