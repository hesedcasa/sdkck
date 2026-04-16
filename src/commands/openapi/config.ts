import {Args, Command, Flags} from '@oclif/core'

import {readStore, writeStore} from '../../openapi-store.js'

export default class OpenApiConfig extends Command {
  static args = {
    name: Args.string({
      description: 'API name (as shown in `openapi list`)',
      required: true,
    }),
  }
  static description = 'Update configuration for an imported OpenAPI spec'
  static examples = [
    '<%= config.bin %> openapi config petstore --base-url https://api.example.com',
    '<%= config.bin %> openapi config petstore --rename mystore',
    '<%= config.bin %> openapi config petstore --title "My Petstore" --description "A pet store API"',
  ]
  static flags = {
    'base-url': Flags.string({
      description: 'New base URL for API calls',
      required: false,
    }),
    description: Flags.string({
      description: 'New description for the spec',
      required: false,
    }),
    insecure: Flags.boolean({
      allowNo: true,
      description: 'Skip TLS certificate verification (--no-insecure to disable)',
      required: false,
    }),
    rename: Flags.string({
      description: 'New short identifier for this API',
      required: false,
    }),
    title: Flags.string({
      description: 'New display title for the spec',
      required: false,
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(OpenApiConfig)

    if (!flags['base-url'] && !flags.rename && !flags.title && !flags.description && flags.insecure === undefined) {
      this.error('Provide at least one flag to update: --base-url, --rename, --title, --description, --insecure')
    }

    const store = await readStore(this.config.configDir)
    const spec = store.specs[args.name]
    if (!spec) {
      this.error(`No spec found with name "${args.name}". Run \`openapi list\` to see available specs.`)
    }

    if (flags['base-url'] !== undefined) spec.baseUrl = flags['base-url']
    if (flags.title !== undefined) spec.title = flags.title
    if (flags.description !== undefined) spec.description = flags.description
    if (flags.insecure !== undefined) spec.insecure = flags.insecure

    if (flags.rename !== undefined && flags.rename !== args.name) {
      const newName = flags.rename
      if (store.specs[newName]) {
        this.error(`A spec named "${newName}" already exists.`)
      }

      spec.name = newName
      store.specs[newName] = spec
      delete store.specs[args.name]

      // Delete the old file by writing the updated store (writeStore writes per-name files)
      // and removing the old file separately
      const {deleteSpec} = await import('../../openapi-store.js')
      await deleteSpec(this.config.configDir, args.name)
    }

    await writeStore(this.config.configDir, store)

    const finalName = flags.rename ?? args.name
    this.log(`Updated "${finalName}".`)
    this.log(`  Base URL   : ${spec.baseUrl || '(none)'}`)
    this.log(`  Title      : ${spec.title}`)
    this.log(`  Description: ${spec.description || '(none)'}`)
  }
}
