import {Args, Command, Flags} from '@oclif/core'
import {action} from '@oclif/core/ux'

import {
  type AuthScheme,
  extractBaseUrl,
  extractOperations,
  loadSpec,
  readStore,
  writeStore,
} from '../../openapi-store.js'

export default class OpenApiImport extends Command {
  static args = {
    source: Args.string({
      description: 'Path to a local OpenAPI spec or Postman collection (file or URL)',
      required: true,
    }),
  }
  static description = 'Import an OpenAPI spec or Postman collection and register its endpoints as commands'
  static examples = [
    '<%= config.bin %> openapi import ./petstore.yaml',
    '<%= config.bin %> openapi import https://petstore3.swagger.io/api/v3/openapi.json',
    '<%= config.bin %> openapi import ./api.json --name myapi --base-url https://api.example.com',
    '<%= config.bin %> openapi import ./api.yaml --auth-type bearer --token sk-...',
    '<%= config.bin %> openapi import ./api.yaml --auth-type apikey --api-key mykey --api-key-header X-API-Key',
    '<%= config.bin %> openapi import ./api.yaml --auth-type basic --username user --password pass',
    '<%= config.bin %> openapi import ./postman_collection.json',
    '<%= config.bin %> openapi import ./postman_collection.json --name myapi --base-url https://api.example.com',
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
      description: 'Override the base URL for API calls (e.g. https://api.example.com)',
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
    const {args, flags} = await this.parse(OpenApiImport)

    action.start(`Loading spec from ${args.source}`)
    let spec
    try {
      spec = await loadSpec(args.source)
      action.stop('✓')
    } catch (error) {
      action.stop('✗')
      this.error(`Failed to load spec: ${(error as Error).message}`)
    }

    if (!spec.paths) {
      this.error('Spec has no "paths" section')
    }

    const title = spec.info?.title ?? 'Unnamed API'
    const description = spec.info?.description ?? ''
    const nameSlug = (
      flags.name ??
      title
        .toLowerCase()
        .replaceAll(/[^\w]+/g, '-')
        .replaceAll(/^-|-$/g, '')
    ).slice(0, 64)

    const baseUrl = flags['base-url'] ?? extractBaseUrl(spec)
    if (!baseUrl) {
      this.warn(
        'Could not determine a base URL from the spec. Use --base-url to set one, or pass it per-call with `openapi call --base-url`.',
      )
    }

    // ── Build auth scheme ──────────────────────────────────────────────────────
    let auth: AuthScheme = {type: 'none'}

    const authType = flags['auth-type']
    switch (authType) {
      case 'apikey': {
        if (!flags['api-key']) this.error('--api-key is required when --auth-type is apikey')
        auth = {apiKey: flags['api-key'], header: flags['api-key-header']!, type: 'apikey'}

        break
      }

      case 'basic': {
        if (!flags.username) this.error('--username is required when --auth-type is basic')
        if (!flags.password) this.error('--password is required when --auth-type is basic')
        auth = {password: flags.password, type: 'basic', username: flags.username}

        break
      }

      case 'bearer': {
        if (!flags.token) this.error('--token is required when --auth-type is bearer')
        auth = {scheme: 'bearer', token: flags.token, type: 'http'}

        break
      }
      // No default
    }

    // ── Extract operations ─────────────────────────────────────────────────────
    const operations = extractOperations(spec)
    if (operations.length === 0) {
      this.warn('No operations found in the spec.')
    }

    // ── Persist ────────────────────────────────────────────────────────────────
    const store = await readStore(this.config.configDir)
    store.specs[nameSlug] = {auth, baseUrl, description, name: nameSlug, operations, source: args.source, title}
    await writeStore(this.config.configDir, store)

    this.log(`\nImported "${title}" as "${nameSlug}"`)
    this.log(`  Base URL  : ${baseUrl || '(none — supply with --base-url at call time)'}`)
    this.log(`  Auth      : ${authType ?? 'none'}`)
    this.log(`  Operations: ${operations.length}`)
    this.log(`\nRun \`${this.config.bin} openapi list ${nameSlug}\` to see all operations.`)
    this.log(`Run \`${this.config.bin} openapi call ${nameSlug} <operationId> [params]\` to make a call.`)
  }
}
