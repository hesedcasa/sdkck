import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {type ApiStore, readStore, type StoredSpec, writeStore} from '../../../src/api-store.js'
import ApiAuth, {
  applyActivateProfile,
  applyDeleteProfile,
  applySaveAuth,
  applyUpdateProfileBaseUrl,
  buildAuthScheme,
} from '../../../src/commands/api/auth.js'

const FIXTURE_STORE: ApiStore = {
  specs: {
    petstore: {
      auth: {type: 'none'},
      baseUrl: 'https://petstore.example.com',
      description: '',
      name: 'petstore',
      operations: [],
      source: './petstore.json',
      title: 'Petstore',
    },
  },
}

function makeAuth(argv: string[], configDir: string): {cmd: ApiAuth; output: () => string} {
  const lines: string[] = []
  const config = {
    bin: 'sdkck',
    configDir,
    runHook: async () => ({failures: [], successes: []}),
  } as never

  const cmd = new ApiAuth(argv, config)
  cmd.log = (message = '') => {
    lines.push(String(message))
  }

  return {cmd, output: () => lines.join('\n')}
}

function makeSpec(overrides: Partial<StoredSpec> = {}): StoredSpec {
  return {
    auth: {type: 'none'},
    baseUrl: 'https://example.com',
    description: '',
    name: 'test',
    operations: [],
    source: '',
    title: '',
    ...overrides,
  }
}

describe('api auth', () => {
  describe('buildAuthScheme', () => {
    it('returns bearer auth', () => {
      const auth = buildAuthScheme({token: 'tok-abc', type: 'bearer'})
      expect(auth).to.deep.equal({scheme: 'bearer', token: 'tok-abc', type: 'http'})
    })

    it('returns apikey auth with default header', () => {
      const auth = buildAuthScheme({'api-key': 'k', type: 'apikey'})
      expect(auth).to.deep.equal({apiKey: 'k', header: 'X-API-Key', type: 'apikey'})
    })

    it('returns apikey auth with custom header', () => {
      const auth = buildAuthScheme({'api-key': 'k', 'api-key-header': 'Authorization', type: 'apikey'})
      expect(auth).to.deep.equal({apiKey: 'k', header: 'Authorization', type: 'apikey'})
    })

    it('returns basic auth', () => {
      const auth = buildAuthScheme({password: 'pass', type: 'basic', username: 'bob'})
      expect(auth).to.deep.equal({password: 'pass', type: 'basic', username: 'bob'})
    })

    it('returns custom auth', () => {
      const auth = buildAuthScheme({header: ['X-Foo=bar'], type: 'custom'})
      expect(auth).to.deep.equal({headers: {'X-Foo': 'bar'}, type: 'custom'})
    })

    it('returns none auth', () => {
      expect(buildAuthScheme({type: 'none'})).to.deep.equal({type: 'none'})
    })

    it('throws when --token missing for bearer', () => {
      expect(() => buildAuthScheme({type: 'bearer'})).to.throw('--token is required')
    })

    it('throws when --api-key missing for apikey', () => {
      expect(() => buildAuthScheme({type: 'apikey'})).to.throw('--api-key is required')
    })

    it('throws when --username missing for basic', () => {
      expect(() => buildAuthScheme({type: 'basic'})).to.throw('--username is required')
    })

    it('throws when --header missing for custom', () => {
      expect(() => buildAuthScheme({type: 'custom'})).to.throw('--header is required')
    })
  })

  describe('applyDeleteProfile', () => {
    it('removes the profile from spec', () => {
      const spec = makeSpec()
      const profiles = {dev: {auth: {type: 'none' as const}}}
      applyDeleteProfile(spec, profiles, 'dev')
      expect(profiles).to.not.have.property('dev')
      expect(spec.authProfiles).to.deep.equal({})
    })

    it('clears activeProfile when it matches', () => {
      const spec = makeSpec({activeProfile: 'dev'})
      const profiles = {dev: {auth: {type: 'none' as const}}}
      applyDeleteProfile(spec, profiles, 'dev')
      expect(spec.activeProfile).to.be.undefined
    })

    it('throws when profile not found', () => {
      expect(() => applyDeleteProfile(makeSpec(), {}, 'missing')).to.throw('No profile "missing" found')
    })
  })

  describe('applyActivateProfile', () => {
    it('copies auth and baseUrl from profile into spec', () => {
      const spec = makeSpec()
      const profiles = {
        prod: {
          auth: {scheme: 'bearer' as const, token: 'tok', type: 'http' as const},
          baseUrl: 'https://prod.example.com',
        },
      }
      applyActivateProfile(spec, profiles, 'prod')
      expect(spec.auth).to.deep.equal(profiles.prod.auth)
      expect(spec.baseUrl).to.equal('https://prod.example.com')
      expect(spec.activeProfile).to.equal('prod')
    })

    it('throws when profile not found', () => {
      expect(() => applyActivateProfile(makeSpec(), {}, 'missing')).to.throw('No profile "missing" found')
    })
  })

  describe('applyUpdateProfileBaseUrl', () => {
    it('updates baseUrl on existing profile', () => {
      const spec = makeSpec()
      const profiles = {dev: {auth: {type: 'none' as const}}}
      applyUpdateProfileBaseUrl(spec, profiles, 'dev', 'https://new.example.com')
      expect(spec.authProfiles?.dev?.baseUrl).to.equal('https://new.example.com')
    })

    it('updates spec.baseUrl when profile is active', () => {
      const spec = makeSpec({activeProfile: 'dev'})
      const profiles = {dev: {auth: {type: 'none' as const}}}
      applyUpdateProfileBaseUrl(spec, profiles, 'dev', 'https://new.example.com')
      expect(spec.baseUrl).to.equal('https://new.example.com')
    })

    it('throws when profile not found', () => {
      expect(() => applyUpdateProfileBaseUrl(makeSpec(), {}, 'missing', 'https://x.com')).to.throw(
        'No profile "missing" found',
      )
    })
  })

  describe('applySaveAuth', () => {
    it('saves to named profile and activates it', () => {
      const spec = makeSpec()
      const auth = {scheme: 'bearer' as const, token: 'tok', type: 'http' as const}
      applySaveAuth(spec, {}, {profile: 'prod'}, auth)
      expect(spec.auth).to.deep.equal(auth)
      expect(spec.activeProfile).to.equal('prod')
      expect(spec.authProfiles?.prod?.auth).to.deep.equal(auth)
    })

    it('saves to "default" profile when no profile flag', () => {
      const spec = makeSpec()
      const auth = {type: 'none' as const}
      applySaveAuth(spec, {}, {}, auth)
      expect(spec.activeProfile).to.equal('default')
      expect(spec.authProfiles?.default?.auth).to.deep.equal(auth)
    })
  })

  describe('command', () => {
    let tmpDir: string

    before(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-test-'))
    })

    after(async () => {
      await rm(tmpDir, {recursive: true})
    })

    async function freshConfig(): Promise<string> {
      const configDir = join(tmpDir, `config-auth-${Date.now()}`)
      await writeStore(configDir, FIXTURE_STORE)
      return configDir
    }

    it('shows current auth when no --type flag is given', async () => {
      const configDir = await freshConfig()
      const {cmd, output} = makeAuth(['petstore'], configDir)
      await cmd.run()
      expect(output()).to.include('none')
    })

    it('shows no-type hint when no --type flag is given', async () => {
      const configDir = await freshConfig()
      const {cmd, output} = makeAuth(['petstore'], configDir)
      await cmd.run()
      expect(output()).to.include('--type')
    })

    it('updates to bearer auth', async () => {
      const configDir = await freshConfig()
      const {cmd} = makeAuth(['petstore', '--type', 'bearer', '--token', 'tok-abc'], configDir)
      await cmd.run()

      const store = await readStore(configDir)
      const {auth} = store.specs.petstore
      expect(auth.type).to.equal('http')
      if (auth.type === 'http') {
        expect(auth.token).to.equal('tok-abc')
      }
    })

    it('updates to apikey auth', async () => {
      const configDir = await freshConfig()
      const {cmd} = makeAuth(
        ['petstore', '--type', 'apikey', '--api-key', 'key99', '--api-key-header', 'X-Token'],
        configDir,
      )
      await cmd.run()

      const store = await readStore(configDir)
      const {auth} = store.specs.petstore
      expect(auth.type).to.equal('apikey')
      if (auth.type === 'apikey') {
        expect(auth.apiKey).to.equal('key99')
        expect(auth.header).to.equal('X-Token')
      }
    })

    it('updates to basic auth', async () => {
      const configDir = await freshConfig()
      const {cmd} = makeAuth(['petstore', '--type', 'basic', '--username', 'bob', '--password', 'hunter2'], configDir)
      await cmd.run()

      const store = await readStore(configDir)
      const {auth} = store.specs.petstore
      expect(auth.type).to.equal('basic')
      if (auth.type === 'basic') {
        expect(auth.username).to.equal('bob')
        expect(auth.password).to.equal('hunter2')
      }
    })

    it('resets auth to none', async () => {
      const configDir = await freshConfig()
      await makeAuth(['petstore', '--type', 'bearer', '--token', 'tok'], configDir).cmd.run()
      await makeAuth(['petstore', '--type', 'none'], configDir).cmd.run()

      const store = await readStore(configDir)
      expect(store.specs.petstore.auth.type).to.equal('none')
    })

    describe('profiles', () => {
      it('saves a named profile and activates it', async () => {
        const configDir = await freshConfig()
        await makeAuth(
          ['petstore', '--profile', 'prod', '--type', 'bearer', '--token', 'tok-prod'],
          configDir,
        ).cmd.run()

        const store = await readStore(configDir)
        const spec = store.specs.petstore
        expect(spec.activeProfile).to.equal('prod')
        expect(spec.auth.type).to.equal('http')
        if (spec.auth.type === 'http') expect(spec.auth.token).to.equal('tok-prod')
        expect(spec.authProfiles?.prod?.auth.type).to.equal('http')
      })

      it('saves multiple profiles independently', async () => {
        const configDir = await freshConfig()
        await makeAuth(['petstore', '--profile', 'dev', '--type', 'bearer', '--token', 'tok-dev'], configDir).cmd.run()
        await makeAuth(
          ['petstore', '--profile', 'prod', '--type', 'bearer', '--token', 'tok-prod'],
          configDir,
        ).cmd.run()

        const store = await readStore(configDir)
        const spec = store.specs.petstore
        expect(Object.keys(spec.authProfiles ?? {})).to.have.lengthOf(2)
        expect(spec.activeProfile).to.equal('prod')
      })

      it('--type without --profile saves as "default" profile', async () => {
        const configDir = await freshConfig()
        await makeAuth(['petstore', '--profile', 'dev', '--type', 'bearer', '--token', 'tok-dev'], configDir).cmd.run()
        await makeAuth(['petstore', '--type', 'none'], configDir).cmd.run()

        const store = await readStore(configDir)
        const spec = store.specs.petstore
        expect(spec.activeProfile).to.equal('default')
        expect(spec.auth.type).to.equal('none')
        expect(spec.authProfiles?.default?.auth.type).to.equal('none')
      })

      it('--profile --base-url (no --type) updates only baseUrl of existing profile', async () => {
        const configDir = await freshConfig()
        await makeAuth(['petstore', '--profile', 'dev', '--type', 'bearer', '--token', 'tok-dev'], configDir).cmd.run()
        await makeAuth(['petstore', '--profile', 'dev', '--base-url', 'https://dev.example.com'], configDir).cmd.run()

        const store = await readStore(configDir)
        const profile = store.specs.petstore.authProfiles?.dev
        expect(profile?.baseUrl).to.equal('https://dev.example.com')
        expect(profile?.auth.type).to.equal('http')
      })

      it('migrates old AuthScheme-only profiles on read', async () => {
        const configDir = await freshConfig()
        const store = await readStore(configDir)
        const spec = store.specs.petstore
        ;(spec as unknown as Record<string, unknown>).authProfiles = {
          legacy: {scheme: 'bearer', token: 'old-token', type: 'http'},
        }
        await writeStore(configDir, store)

        const reloaded = await readStore(configDir)
        const profile = reloaded.specs.petstore.authProfiles?.legacy
        expect(profile?.auth.type).to.equal('http')
        if (profile?.auth.type === 'http') expect(profile.auth.token).to.equal('old-token')
      })
    })
  })
})
