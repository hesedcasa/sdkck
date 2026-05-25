import {Args, Command, Flags} from '@oclif/core'
import {action} from '@oclif/core/ux'

import {
  type AuthScheme,
  buildAuthHeaders,
  extractBaseUrl,
  extractOperations,
  loadSpec,
  readStore,
  writeStore,
} from '../../api-store.js'
import {convertSchema, hasGraphQLExtension, loadGraphQLSchema} from '../../graphql-converter.js'

function looksLikeGraphQLEndpoint(source: string): boolean {
  if (!source.startsWith('http://') && !source.startsWith('https://')) return false
  try {
    const url = new URL(source)
    return /(^|\/)graphql\/?$/i.test(url.pathname)
  } catch {
    return false
  }
}

export default class ApiImport extends Command {
  static args = {
    source: Args.string({
      description: 'Path to a local OpenAPI/Postman/GraphQL spec or URL (REST or GraphQL endpoint)',
      required: true,
    }),
  }
  static description =
    'Import an OpenAPI spec, Postman collection, or GraphQL schema (SDL/introspection/endpoint) and register its operations as commands'
  static examples = [
    '<%= config.bin %> api import ./petstore.json  --name petstore',
    '<%= config.bin %> api import ./postman_collection.json --name myapi',
    '<%= config.bin %> api import https://petstore3.swagger.io/api/v3/openapi.json',
    '<%= config.bin %> api import ./schema.graphql --base-url https://api.example.com/graphql',
    '<%= config.bin %> api import https://api.example.com/graphql --name github',
    '<%= config.bin %> api import ./api.yaml --auth-type bearer --token sk-...',
    '<%= config.bin %> api import ./api.yaml --auth-type apikey --api-key mykey --api-key-header X-API-Key',
    '<%= config.bin %> api import ./api.yaml --auth-type basic --username user --password pass',
  ]
  static flags = {
    'api-key': Flags.string({
      description: 'API key value (used with --auth-type apikey)',
      required: false,
    }),
    'api-key-header': Flags.string({
      default: 'X-API-Key',
      description: 'Header name for the API key',
      required: false,
    }),
    'auth-type': Flags.string({
      description: 'Authentication type',
      options: ['none', 'bearer', 'apikey', 'basic'],
      required: false,
    }),
    'base-url': Flags.string({
      description: 'Override the base URL for API calls (GraphQL endpoint URL for GraphQL imports)',
      required: false,
    }),
    graphql: Flags.boolean({
      default: false,
      description: 'Treat the source as a GraphQL schema (SDL, introspection JSON, or live endpoint)',
      required: false,
    }),
    insecure: Flags.boolean({
      default: false,
      description: 'Skip TLS certificate verification (useful for self-signed certs)',
      required: false,
    }),
    name: Flags.string({
      description: 'Short identifier for this API (defaults to the spec title slug)',
      required: false,
    }),
    password: Flags.string({
      description: 'Password for basic auth',
      required: false,
    }),
    'selection-depth': Flags.integer({
      default: 3,
      description: 'Max depth of auto-generated GraphQL selection sets (GraphQL imports only)',
      required: false,
    }),
    token: Flags.string({
      description: 'Bearer token (used with --auth-type bearer)',
      required: false,
    }),
    username: Flags.string({
      description: 'Username for basic auth',
      required: false,
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(ApiImport)

    const auth = this.buildAuth(flags)
    const useGraphQL = flags.graphql || hasGraphQLExtension(args.source) || looksLikeGraphQLEndpoint(args.source)

    const imported = useGraphQL
      ? await this.loadGraphQL(args.source, auth, flags['selection-depth'] ?? 3)
      : await this.loadOpenApi(args.source, flags['base-url'])

    const nameSlug = this.resolveName(flags.name, imported.title)

    const store = await readStore(this.config.configDir)
    if (store.specs[nameSlug]) {
      this.error(`A spec named "${nameSlug}" already exists.`)
    }

    const baseUrl = flags['base-url'] ?? imported.baseUrl
    if (!baseUrl) {
      this.warn(
        useGraphQL
          ? 'No base URL set. GraphQL imports from SDL need --base-url pointing at the GraphQL endpoint.'
          : 'Could not determine a base URL from the spec. Use --base-url to set one.',
      )
    }

    if (imported.operations.length === 0) {
      this.warn('No operations found in the spec.')
    }

    store.specs[nameSlug] = {
      auth,
      baseUrl,
      description: imported.description,
      insecure: flags.insecure,
      kind: useGraphQL ? 'graphql' : 'openapi',
      name: nameSlug,
      operations: imported.operations,
      source: args.source,
      title: imported.title,
    }
    await writeStore(this.config.configDir, store)

    this.log(`\nImported "${imported.title}" as "${nameSlug}"${useGraphQL ? ' [graphql]' : ''}`)
    this.log(`  Base URL  : ${baseUrl || 'none'}`)
    this.log(`  Auth      : ${flags['auth-type'] ?? 'none'}`)
    this.log(`  Operations: ${imported.operations.length}`)
    this.log(`\nRun '${this.config.bin} ${nameSlug}' to see all operations.`)
  }

  private buildAuth(flags: {
    'api-key'?: string
    'api-key-header'?: string
    'auth-type'?: string
    password?: string
    token?: string
    username?: string
  }): AuthScheme {
    switch (flags['auth-type']) {
      case 'apikey': {
        if (!flags['api-key']) this.error('--api-key is required when --auth-type is apikey')
        return {apiKey: flags['api-key'], header: flags['api-key-header']!, type: 'apikey'}
      }

      case 'basic': {
        if (!flags.username) this.error('--username is required when --auth-type is basic')
        if (!flags.password) this.error('--password is required when --auth-type is basic')
        return {password: flags.password, type: 'basic', username: flags.username}
      }

      case 'bearer': {
        if (!flags.token) this.error('--token is required when --auth-type is bearer')
        return {scheme: 'bearer', token: flags.token, type: 'http'}
      }

      default: {
        return {type: 'none'}
      }
    }
  }

  private async loadGraphQL(
    source: string,
    auth: AuthScheme,
    selectionDepth: number,
  ): Promise<{
    baseUrl: string
    description: string
    operations: ReturnType<typeof convertSchema>['operations']
    title: string
  }> {
    action.start(`Loading GraphQL schema from ${source}`)
    try {
      const schema = await loadGraphQLSchema(source, {headers: buildAuthHeaders(auth)})
      const result = convertSchema(schema, {selectionDepth})
      action.stop('✓')
      const baseUrl = source.startsWith('http') ? source.replace(/\/$/, '') : ''
      return {baseUrl, description: result.description ?? '', operations: result.operations, title: result.title}
    } catch (error) {
      action.stop('✗')
      this.error(`Failed to load GraphQL schema: ${(error as Error).message}`)
    }
  }

  private async loadOpenApi(
    source: string,
    baseUrlOverride: string | undefined,
  ): Promise<{baseUrl: string; description: string; operations: ReturnType<typeof extractOperations>; title: string}> {
    action.start(`Loading spec from ${source}`)
    try {
      const spec = await loadSpec(source)
      action.stop('✓')
      if (!spec.paths) this.error('Spec has no "paths" section')
      return {
        baseUrl: baseUrlOverride ?? extractBaseUrl(spec),
        description: spec.info?.description ?? '',
        operations: extractOperations(spec),
        title: spec.info?.title ?? 'Unnamed API',
      }
    } catch (error) {
      action.stop('✗')
      this.error(`Failed to load spec: ${(error as Error).message}`)
    }
  }

  private resolveName(flag: string | undefined, title: string): string {
    return (
      flag ??
      title
        .toLowerCase()
        .replaceAll(/[^\w]+/g, '-')
        .replaceAll(/^-|-$/g, '')
    ).slice(0, 64)
  }
}
