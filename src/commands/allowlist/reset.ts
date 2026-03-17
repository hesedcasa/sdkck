import {Command, Flags} from '@oclif/core'
import * as readline from 'node:readline'

import {writeAllowlistConfig} from '../../allowlist-config.js'

export default class AllowlistReset extends Command {
  static description = 'Reset all plugin command allowlist rules'
  static examples = ['<%= config.bin %> allowlist reset', '<%= config.bin %> allowlist reset --confirm']
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
    const {flags} = await this.parse(AllowlistReset)

    if (!flags.confirm) {
      const answer = await this._prompt('This will remove all allowlist rules. Type "yes" to confirm')
      if (answer.toLowerCase() !== 'yes') {
        this.log('Reset cancelled.')
        return
      }
    }

    await writeAllowlistConfig(this.config.configDir, {rules: []})
    this.log('All allowlist rules have been removed.')
  }
}
