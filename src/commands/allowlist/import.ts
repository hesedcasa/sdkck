import {Args, Command} from '@oclif/core'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'

import {AllowlistConfig, writeAllowlistConfig} from '../../allowlist-config.js'

export default class AllowlistImport extends Command {
  static args = {
    file: Args.string({
      description: 'Path to the JSON file to import the allowlist configuration from',
      required: true,
    }),
  }
  static description = 'Import the plugin command allowlist configuration from a JSON file'
  static examples = ['<%= config.bin %> allowlist import allowlist.json']

  async run(): Promise<void> {
    const {args} = await this.parse(AllowlistImport)
    const filePath = resolve(args.file)

    let raw: string
    try {
      raw = await readFile(filePath, 'utf8')
    } catch {
      this.error(`Could not read file "${filePath}". Make sure the file exists and is readable.`)
    }

    let config: AllowlistConfig
    try {
      config = JSON.parse(raw) as AllowlistConfig
    } catch {
      this.error(`File "${filePath}" does not contain valid JSON.`)
    }

    if (!Array.isArray(config.rules)) {
      this.error(`File "${filePath}" is not a valid allowlist configuration (missing "rules" array).`)
    }

    for (const [i, rule] of config.rules.entries()) {
      if (typeof rule.pattern !== 'string' || (rule.action !== 'allow' && rule.action !== 'disallow')) {
        this.error(
          `Rule at index ${i} is invalid. Each rule must have a string "pattern" and an "action" of "allow" or "disallow".`,
        )
      }
    }

    await writeAllowlistConfig(this.config.configDir, config)
    this.log(`Imported ${config.rules.length} rule${config.rules.length === 1 ? '' : 's'} from "${filePath}".`)
  }
}
