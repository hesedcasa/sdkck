import {Args, Command} from '@oclif/core'
import {writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'

import {readAllowlistConfig} from '../../allowlist-config.js'

export default class AllowlistExport extends Command {
  static args = {
    file: Args.string({
      description: 'Path to the JSON file to export the allowlist configuration to',
      required: true,
    }),
  }
  static description = 'Export the plugin command allowlist configuration to a JSON file'
  static examples = ['<%= config.bin %> allowlist export allowlist.json']

  async run(): Promise<void> {
    const {args} = await this.parse(AllowlistExport)
    const filePath = resolve(args.file)

    const config = await readAllowlistConfig(this.config.configDir)
    await writeFile(filePath, JSON.stringify(config, null, 2), 'utf8')
    this.log(`Allowlist configuration exported to "${filePath}".`)
  }
}
