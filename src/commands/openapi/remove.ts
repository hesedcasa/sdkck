import {Args, Command} from '@oclif/core'

import {deleteSpec, readStore} from '../../openapi-store.js'

export default class OpenApiRemove extends Command {
  static args = {
    name: Args.string({
      description: 'API name to remove',
      required: true,
    }),
  }
  static description = 'Remove an imported OpenAPI spec'
  static examples = ['<%= config.bin %> openapi remove petstore']

  async run(): Promise<void> {
    const {args} = await this.parse(OpenApiRemove)

    const store = await readStore(this.config.configDir)
    if (!store.specs[args.name]) {
      this.error(`No spec found with name "${args.name}"`)
    }

    await deleteSpec(this.config.configDir, args.name)
    this.log(`Removed "${args.name}".`)
  }
}
