import {Args, Command} from '@oclif/core'

import {readStore} from '../../openapi-store.js'

export default class OpenApiList extends Command {
  static args = {
    name: Args.string({
      description: 'API name to list operations for (omit to list all imported APIs)',
      required: false,
    }),
  }
  static description = 'List imported OpenAPI specs and their available operations'
  static examples = ['<%= config.bin %> openapi list', '<%= config.bin %> openapi list petstore']

  async run(): Promise<void> {
    const {args} = await this.parse(OpenApiList)
    const store = await readStore(this.config.configDir)
    const specs = Object.values(store.specs)

    if (specs.length === 0) {
      this.log('No OpenAPI specs imported yet. Run `openapi import` to add one.')
      return
    }

    if (args.name) {
      const spec = store.specs[args.name]
      if (!spec) {
        this.error(`No spec found with name "${args.name}". Run \`openapi list\` to see available specs.`)
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
        this.log(`  ${op.method.toUpperCase().padEnd(7)} ${op.operationId}${paramsStr}`)
        this.log(`          ${op.description}`)
        this.log(`          → ${op.path}`)
        this.log('')
      }
    } else {
      this.log(`Imported APIs (${specs.length}):`)
      for (const spec of specs) {
        this.log(`  ${spec.name}: ${spec.title} (${spec.operations.length} operations)`)
        this.log(`  → ${spec.baseUrl || '(no base URL)'}`)
      }

      this.log('')
      this.log(`Run \`openapi list <name>\` to see operations for a specific API.`)
    }
  }
}
