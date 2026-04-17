import {Args, Command} from '@oclif/core'

import {deleteSpec, readStore} from '../../api-store.js'

export default class ApiRemove extends Command {
  static args = {
    name: Args.string({
      description: 'API name to remove',
      required: true,
    }),
  }
  static description = 'Remove an imported API spec'
  static examples = ['<%= config.bin %> api remove petstore']

  async run(): Promise<void> {
    const {args} = await this.parse(ApiRemove)

    const store = await readStore(this.config.configDir)
    if (!store.specs[args.name]) {
      this.error(`No spec found with name "${args.name}"`)
    }

    await deleteSpec(this.config.configDir, args.name)
    this.log(`Removed "${args.name}".`)
  }
}
