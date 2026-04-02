import {Args, Command, Flags} from '@oclif/core'

import {type AuthScheme, parseKV, readStore, writeStore} from '../../openapi-store.js'

export default class OpenApiAuth extends Command {
  static args = {
    name: Args.string({
      description: 'API name to update authentication for',
      required: true,
    }),
  }
  static description = 'Update the authentication settings for an imported OpenAPI spec'
  static examples = [
    '<%= config.bin %> openapi auth petstore --type bearer --token sk-...',
    '<%= config.bin %> openapi auth petstore --type apikey --api-key mykey',
    '<%= config.bin %> openapi auth petstore --type apikey --api-key mykey --api-key-header Authorization',
    '<%= config.bin %> openapi auth petstore --type basic --username user --password secret',
    '<%= config.bin %> openapi auth petstore --type custom --header X-Tenant-ID=acme --header X-App-Key=secret',
    '<%= config.bin %> openapi auth petstore --type none',
    '<%= config.bin %> openapi auth petstore --show',
  ]
  static flags = {
    'api-key': Flags.string({
      description: 'API key value (used with --type apikey)',
      required: false,
    }),
    'api-key-header': Flags.string({
      default: 'X-API-Key',
      description: 'Header name for the API key',
      required: false,
    }),
    header: Flags.string({
      description: 'Custom header in Key=Value format (used with --type custom, repeatable)',
      multiple: true,
      required: false,
    }),
    password: Flags.string({
      description: 'Password for basic auth',
      required: false,
    }),
    show: Flags.boolean({
      description: 'Show the current authentication settings (tokens are redacted)',
      required: false,
    }),
    token: Flags.string({
      description: 'Bearer token',
      required: false,
    }),
    type: Flags.string({
      description: 'Authentication type to configure',
      options: ['none', 'bearer', 'apikey', 'basic', 'custom'],
      required: false,
    }),
    username: Flags.string({
      description: 'Username for basic auth',
      required: false,
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(OpenApiAuth)

    const store = await readStore(this.config.configDir)
    const spec = store.specs[args.name]
    if (!spec) {
      this.error(`No spec found with name "${args.name}". Run \`openapi list\` to see available specs.`)
    }

    // ── Show mode ──────────────────────────────────────────────────────────────
    if (flags.show) {
      this.log(`Auth for "${args.name}":`)
      this.log(formatAuth(spec.auth))
      return
    }

    if (!flags.type) {
      this.log(`Current auth for "${args.name}":`)
      this.log(formatAuth(spec.auth))
      this.log(`\nUse --type to update (none | bearer | apikey | basic).`)
      return
    }

    // ── Update auth ────────────────────────────────────────────────────────────
    let auth: AuthScheme

    switch (flags.type) {
      case 'apikey': {
        if (!flags['api-key']) this.error('--api-key is required when --type is apikey')
        auth = {apiKey: flags['api-key'], header: flags['api-key-header']!, type: 'apikey'}

        break
      }

      case 'basic': {
        if (!flags.username) this.error('--username is required when --type is basic')
        if (!flags.password) this.error('--password is required when --type is basic')
        auth = {password: flags.password, type: 'basic', username: flags.username}

        break
      }

      case 'bearer': {
        if (!flags.token) this.error('--token is required when --type is bearer')
        auth = {scheme: 'bearer', token: flags.token, type: 'http'}

        break
      }

      case 'custom': {
        if (!flags.header || flags.header.length === 0) this.error('--header is required when --type is custom')
        auth = {headers: parseKV(flags.header), type: 'custom'}

        break
      }

      default: {
        auth = {type: 'none'}
      }
    }

    spec.auth = auth
    store.specs[args.name] = spec
    await writeStore(this.config.configDir, store)

    this.log(`Updated auth for "${args.name}" to: ${flags.type}`)
  }
}

function redact(value: string): string {
  if (value.length <= 8) return '***'
  return value.slice(0, 4) + '***' + value.slice(-4)
}

function formatAuth(auth: AuthScheme): string {
  switch (auth.type) {
    case 'apikey': {
      return `  type   : apikey\n  header : ${auth.header}\n  key    : ${redact(auth.apiKey)}`
    }

    case 'basic': {
      return `  type     : basic\n  username : ${auth.username}\n  password : ${redact(auth.password)}`
    }

    case 'custom': {
      const headerLines = Object.entries(auth.headers)
        .map(([k, v]) => `  ${k} : ${redact(v)}`)
        .join('\n')
      return `  type: custom\n${headerLines}`
    }

    case 'http': {
      return `  type  : bearer\n  token : ${redact(auth.token)}`
    }

    default: {
      return '  type: none'
    }
  }
}
