import {Args, Command} from '@oclif/core'
import {writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'

import {readPermissionConfig} from '../../permission-config.js'

export default class PermissionExport extends Command {
  static args = {
    file: Args.string({
      description: 'Path to the JSON file to export the permission configuration to',
      required: true,
    }),
  }
  static description = 'Export the plugin command permission configuration to a JSON file'
  static examples = ['<%= config.bin %> permission export permission.json']

  async run(): Promise<void> {
    const {args} = await this.parse(PermissionExport)
    const filePath = resolve(args.file)

    const config = await readPermissionConfig(this.config.configDir)
    await writeFile(filePath, JSON.stringify(config, null, 2), 'utf8')
    this.log(`Permission configuration exported to "${filePath}".`)
  }
}
