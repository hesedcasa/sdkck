import {Args, Command} from '@oclif/core'

import {readStore} from '../../api-store.js'

export default class ApiList extends Command {
  static args = {
    name: Args.string({
      description: 'API name to list operations for (omit to list all imported APIs)',
      required: false,
    }),
  }
  static description = 'List imported API specs and their available operations'
  static examples = ['<%= config.bin %> api list', '<%= config.bin %> api list petstore']

  async run(): Promise<void> {
    const {args} = await this.parse(ApiList)
    const store = await readStore(this.config.configDir)
    const specs = Object.values(store.specs)

    if (specs.length === 0) {
      this.log('No API specs imported yet. Run `api import` to add one.')
      return
    }

    if (args.name) {
      const spec = store.specs[args.name]
      if (!spec) {
        this.error(`No spec found with name "${args.name}". Run 'api list' to see available specs.`)
      }

      this.log(`${spec.title} (${spec.name})`)
      if (spec.description) this.log(spec.description)
      this.log(`  Base URL: ${spec.baseUrl || '(not set)'}`)
      this.log(`  Source  : ${spec.source}`)
      this.log(`  Auth    : ${spec.auth.type}`)
      this.log(`\nOperations (${spec.operations.length}):\n`)

      for (const op of spec.operations) {
        const paramNames = [
          ...op.parameters.map((p) => (p.required ? `<${p.name}>` : `[${p.name}]`)),
          ...Object.entries(op.bodyParams).map(([n, b]) => (b.required ? `<${n}>` : `[${n}]`)),
        ]
        const paramsStr = paramNames.length > 0 ? `  ${paramNames.join(' ')}` : ''
        const label = op.graphql ? op.graphql.operationType.toUpperCase() : op.method.toUpperCase()
        const target = op.graphql ? op.graphql.fieldName : op.path
        this.log(`  ${label.padEnd(8)} ${op.operationId}${paramsStr}`)
        this.log(`          ${op.description}`)
        this.log(`          → ${target}`)
        this.log('')
      }
    } else {
      this.log(`Imported APIs (${specs.length}):`)
      for (const spec of specs) {
        const kind = spec.kind === 'graphql' ? ' [graphql]' : ''
        this.log(`  ${spec.name}${kind}: ${spec.title} (${spec.operations.length} operations)`)
        this.log(`  → ${spec.baseUrl || '(no base URL)'}`)
      }

      this.log('')
      this.log(`Run 'api list <name>' to see operations for a specific API.`)
    }
  }
}
