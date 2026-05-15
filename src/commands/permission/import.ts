import {Args, Command} from '@oclif/core'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'

import {PermissionConfig, writePermissionConfig} from '../../permission-config.js'

export default class PermissionImport extends Command {
  static args = {
    file: Args.string({
      description: 'Path to the JSON file to import the permission configuration from',
      required: true,
    }),
  }
  static description = 'Import the plugin command permission configuration from a JSON file'
  static examples = ['<%= config.bin %> permission import permission.json']

  async run(): Promise<void> {
    const {args} = await this.parse(PermissionImport)
    const filePath = resolve(args.file)

    let raw: string
    try {
      raw = await readFile(filePath, 'utf8')
    } catch {
      this.error(`Could not read file "${filePath}". Make sure the file exists and is readable.`)
    }

    let config: PermissionConfig
    try {
      config = JSON.parse(raw) as PermissionConfig
    } catch {
      this.error(`File "${filePath}" does not contain valid JSON.`)
    }

    if (!Array.isArray(config.rules)) {
      this.error(`File "${filePath}" is not a valid permission configuration (missing "rules" array).`)
    }

    for (const [i, rule] of config.rules.entries()) {
      if (typeof rule.pattern !== 'string') {
        this.error(`Rule at index ${i} is invalid. Each rule must have a string "pattern".`)
      }
    }

    await writePermissionConfig(this.config.configDir, config)
    this.log(`Imported ${config.rules.length} rule${config.rules.length === 1 ? '' : 's'} from "${filePath}".`)
  }
}
