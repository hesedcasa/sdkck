import {Args, Command, Flags} from '@oclif/core'

import {type AuthScheme, readStore, type StoredProfile, type StoredSpec, writeStore} from '../../api-store.js'
import {applyActivateProfile, applyDeleteProfile} from './auth.js'

export default class ApiProfile extends Command {
  static args = {
    name: Args.string({
      description: 'API name',
      required: true,
    }),
  }
static description = 'Manage auth profiles for an imported API spec'
static examples = [
    '<%= config.bin %> api profile petstore',
    '<%= config.bin %> api profile petstore --show dev',
    '<%= config.bin %> api profile petstore --use prod',
    '<%= config.bin %> api profile petstore --delete dev',
  ]
static flags = {
    delete: Flags.string({
      description: 'Delete a named profile',
      required: false,
    }),
    show: Flags.string({
      description: 'Show auth details for a named profile',
      required: false,
    }),
    use: Flags.string({
      description: 'Activate a named profile',
      required: false,
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(ApiProfile)

    const store = await readStore(this.config.configDir)
    const spec = store.specs[args.name]
    if (!spec) {
      this.error(`No spec found with name "${args.name}". Run 'api list' to see available specs.`)
    }

    const profiles = spec.authProfiles ?? {}

    if (flags.delete) {
      try {
        applyDeleteProfile(spec, profiles, flags.delete)
      } catch (error) {
        this.error((error as Error).message)
      }

      store.specs[args.name] = spec
      await writeStore(this.config.configDir, store)
      this.log(`Deleted profile "${flags.delete}" from "${args.name}".`)
      return
    }

    if (flags.use) {
      try {
        applyActivateProfile(spec, profiles, flags.use)
      } catch (error) {
        this.error((error as Error).message)
      }

      store.specs[args.name] = spec
      await writeStore(this.config.configDir, store)
      this.log(`Activated profile "${flags.use}" for "${args.name}".`)
      return
    }

    if (flags.show) {
      const profile = profiles[flags.show]
      if (!profile) this.error(`No profile "${flags.show}" found.`)
      this.log(`Profile "${flags.show}" for "${args.name}":`)
      this.log(formatProfile(profile))
      return
    }

    this.log(formatProfileList(args.name, spec))
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

function formatProfile(profile: StoredProfile): string {
  const lines = [formatAuth(profile.auth)]
  if (profile.baseUrl) lines.push(`  baseUrl: ${profile.baseUrl}`)
  return lines.join('\n')
}

function formatProfileList(name: string, spec: StoredSpec): string {
  const profiles = spec.authProfiles ?? {}
  if (Object.keys(profiles).length === 0) return `No profiles found for "${name}".`

  const lines = [`Profiles for "${name}":`]
  for (const [profileName, profile] of Object.entries(profiles)) {
    const marker = profileName === spec.activeProfile ? ' *' : ''
    const urlSuffix = profile.baseUrl ? ` ${profile.baseUrl}` : ''
    lines.push(`  ${profileName}${marker}:${urlSuffix}`)
  }

  return lines.join('\n')
}
