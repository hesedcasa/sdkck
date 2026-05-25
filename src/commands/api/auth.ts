import {Args, Command, Flags} from '@oclif/core'

import {type AuthScheme, parseKV, readStore, type StoredProfile, type StoredSpec, writeStore} from '../../api-store.js'

export default class ApiAuth extends Command {
  static args = {
    name: Args.string({
      description: 'API name to update authentication for',
      required: true,
    }),
  }
  static description = 'Update the authentication settings for an imported API spec'
  static examples = [
    '<%= config.bin %> api auth petstore --type bearer --token sk-...',
    '<%= config.bin %> api auth petstore --type apikey --api-key mykey',
    '<%= config.bin %> api auth petstore --type apikey --api-key mykey --api-key-header Authorization',
    '<%= config.bin %> api auth petstore --type basic --username user --password secret',
    '<%= config.bin %> api auth petstore --type custom --header X-Tenant-ID=acme --header X-App-Key=secret',
    '<%= config.bin %> api auth petstore --type none',
    '<%= config.bin %> api auth petstore --type bearer --token sk-prod -p prod --base-url https://api.prod.example.com',
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
    'base-url': Flags.string({
      description: 'Base URL for this profile',
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
    profile: Flags.string({
      char: 'p',
      description: 'Named profile to save',
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
    const {args, flags} = await this.parse(ApiAuth)

    const store = await readStore(this.config.configDir)
    const spec = store.specs[args.name]
    if (!spec) {
      this.error(`No spec found with name "${args.name}". Run 'api list' to see available specs.`)
    }

    const profiles = spec.authProfiles ?? {}

    if (flags.profile && flags['base-url'] && !flags.type) {
      try {
        applyUpdateProfileBaseUrl(spec, profiles, flags.profile, flags['base-url'])
      } catch (error) {
        this.error((error as Error).message)
      }

      store.specs[args.name] = spec
      await writeStore(this.config.configDir, store)
      this.log(`Updated base URL for profile "${flags.profile}" to: ${flags['base-url']}`)
      return
    }

    if (!flags.type) {
      this.log(
        `\nUse --type to update auth (none | bearer | apikey | basic | custom).\nTo manage profiles, use 'api profile ${args.name}'.`,
      )
      return
    }

    let auth: AuthScheme
    try {
      auth = buildAuthScheme({...flags, type: flags.type!})
    } catch (error) {
      this.error((error as Error).message)
    }

    applySaveAuth(spec, profiles, flags, auth)
    store.specs[args.name] = spec
    await writeStore(this.config.configDir, store)
    this.log(
      flags.profile
        ? `Saved and activated profile "${flags.profile}" for "${args.name}": ${flags.type}`
        : `Updated auth for "${args.name}" to: ${flags.type}`,
    )
  }
}

// ── Exported standalone helpers ────────────────────────────────────────────────

export function buildAuthScheme(flags: {
  'api-key'?: string
  'api-key-header'?: string
  header?: string[]
  password?: string
  token?: string
  type: string
  username?: string
}): AuthScheme {
  switch (flags.type) {
    case 'apikey': {
      if (!flags['api-key']) throw new Error('--api-key is required when --type is apikey')
      return {apiKey: flags['api-key'], header: flags['api-key-header'] ?? 'X-API-Key', type: 'apikey'}
    }

    case 'basic': {
      if (!flags.username) throw new Error('--username is required when --type is basic')
      if (!flags.password) throw new Error('--password is required when --type is basic')
      return {password: flags.password, type: 'basic', username: flags.username}
    }

    case 'bearer': {
      if (!flags.token) throw new Error('--token is required when --type is bearer')
      return {scheme: 'bearer', token: flags.token, type: 'http'}
    }

    case 'custom': {
      if (!flags.header || flags.header.length === 0) throw new Error('--header is required when --type is custom')
      return {headers: parseKV(flags.header), type: 'custom'}
    }

    default: {
      return {type: 'none'}
    }
  }
}

export function applyDeleteProfile(
  spec: StoredSpec,
  profiles: Record<string, StoredProfile>,
  profileName: string,
): void {
  if (!profiles[profileName]) throw new Error(`No profile "${profileName}" found.`)
  delete profiles[profileName]
  spec.authProfiles = profiles
  if (spec.activeProfile === profileName) delete spec.activeProfile
}

export function applyActivateProfile(
  spec: StoredSpec,
  profiles: Record<string, StoredProfile>,
  profileName: string,
): void {
  const profile = profiles[profileName]
  if (!profile)
    throw new Error(`No profile "${profileName}" found. Run 'api profile ${spec.name}' to see available profiles.`)
  spec.auth = profile.auth
  if (profile.baseUrl) spec.baseUrl = profile.baseUrl
  spec.activeProfile = profileName
}

export function applyUpdateProfileBaseUrl(
  spec: StoredSpec,
  profiles: Record<string, StoredProfile>,
  profileName: string,
  baseUrl: string,
): void {
  const existing = profiles[profileName]
  if (!existing) throw new Error(`No profile "${profileName}" found. Use --type to create it.`)
  spec.authProfiles = {...profiles, [profileName]: {...existing, baseUrl}}
  if (spec.activeProfile === profileName) spec.baseUrl = baseUrl
}

export function applySaveAuth(
  spec: StoredSpec,
  profiles: Record<string, StoredProfile>,
  flags: {'base-url'?: string; profile?: string},
  auth: AuthScheme,
): void {
  const profileName = flags.profile ?? 'default'
  const existingBaseUrl = flags.profile ? profiles[profileName]?.baseUrl : undefined
  const baseUrl = (flags['base-url'] ?? existingBaseUrl ?? spec.baseUrl) || undefined
  const newProfile: StoredProfile = {auth, ...(baseUrl && {baseUrl})}
  spec.authProfiles = {...profiles, [profileName]: newProfile}
  spec.auth = auth
  spec.activeProfile = profileName
  if (baseUrl) spec.baseUrl = baseUrl
}
