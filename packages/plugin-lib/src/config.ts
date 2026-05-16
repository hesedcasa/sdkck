import {default as fs} from 'fs-extra'
import {default as path} from 'node:path'

export interface AuthConfig {
  apiToken: string
  email?: string
  host: string
}

export interface Config {
  auth: AuthConfig
}

export type Profiles = Record<string, AuthConfig>

export function createProfileManager(configFile: string) {
  function configPath(configDir: string): string {
    return path.join(configDir, configFile)
  }

  async function getDefaultProfile(configDir: string): Promise<string> {
    const cp = configPath(configDir)
    try {
      const raw = await fs.readJSON(cp)
      return raw.defaultProfile || 'default'
    } catch {
      return 'default'
    }
  }

  async function setDefaultProfile(
    configDir: string,
    profile: string,
    log: (message: string) => void,
  ): Promise<void> {
    const profiles = await readProfiles(configDir, log)
    if (!profiles || !(profile in profiles)) {
      log(`Profile '${profile}' not found`)
      return
    }

    const cp = configPath(configDir)
    const raw = await fs.readJSON(cp)
    raw.defaultProfile = profile
    await fs.outputJSON(cp, raw, {spaces: 2})
    log(`Default profile set to '${profile}'`)
  }

  async function readConfig(
    configDir: string,
    log: (message: string) => void,
    profile?: string,
  ): Promise<Config | undefined> {
    const cp = configPath(configDir)

    try {
      const raw = await fs.readJSON(cp)

      if (raw.profiles) {
        const resolvedProfile = profile ?? (await getDefaultProfile(configDir))
        const auth = raw.profiles[resolvedProfile] as AuthConfig | undefined
        if (!auth) {
          log(`Profile '${resolvedProfile}' not found`)
          return undefined
        }

        return {auth}
      }

      // backward compat: old { auth: {...} } format
      if (profile && profile !== 'default') {
        log(`Profile '${profile}' not found`)
        return undefined
      }

      return raw as Config
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.toLowerCase().includes('no such file or directory')) {
        log('Missing authentication config')
      } else {
        log(msg)
      }

      return undefined
    }
  }

  async function readProfiles(configDir: string, log: (message: string) => void): Promise<Profiles | undefined> {
    const cp = configPath(configDir)

    try {
      const raw = await fs.readJSON(cp)
      if (raw.profiles) {
        return raw.profiles as Profiles
      }

      // backward compat: treat old { auth: {...} } as the default profile
      if (raw.auth) {
        return {default: raw.auth as AuthConfig}
      }

      return {}
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.toLowerCase().includes('no such file or directory')) {
        log('No authentication profiles found')
      } else {
        log(msg)
      }

      return undefined
    }
  }

  return {getDefaultProfile, readConfig, readProfiles, setDefaultProfile}
}
