import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {type ApiStore, readStore, writeStore} from '../../../src/api-store.js'
import ApiProfile from '../../../src/commands/api/profile.js'

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

function makeProfile(argv: string[], configDir: string): {cmd: ApiProfile; output: () => string} {
  const lines: string[] = []
  const config = {
    bin: 'sdkck',
    configDir,
    runHook: async () => ({failures: [], successes: []}),
  } as never

  const cmd = new ApiProfile(argv, config)
  cmd.log = (message = '') => {
    lines.push(String(message))
  }

  return {cmd, output: () => lines.join('\n')}
}

async function runExpectingError(cmd: ApiProfile): Promise<string> {
  let errorMsg = ''
  cmd.error = (msg: Error | string) => {
    errorMsg = String(msg)
    throw new Error(errorMsg)
  }

  try {
    await cmd.run()
  } catch {
    // expected
  }

  return errorMsg
}

async function withProfiles(configDir: string): Promise<void> {
  const store = await readStore(configDir)
  const spec = store.specs.petstore
  spec.authProfiles = {
    dev: {auth: {scheme: 'bearer', token: 'tok-dev', type: 'http'}, baseUrl: 'https://dev.example.com'},
    prod: {auth: {scheme: 'bearer', token: 'tok-prod', type: 'http'}, baseUrl: 'https://prod.example.com'},
  }
  spec.activeProfile = 'prod'
  spec.auth = spec.authProfiles.prod.auth
  await writeStore(configDir, store)
}

describe('api profile', () => {
  let tmpDir: string

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-profile-'))
  })

  after(async () => {
    await rm(tmpDir, {recursive: true})
  })

  async function freshConfig(): Promise<string> {
    const configDir = join(tmpDir, `config-profile-${Date.now()}`)
    await writeStore(configDir, FIXTURE_STORE)
    return configDir
  }

  it('errors when spec not found', async () => {
    const configDir = await freshConfig()
    const {cmd} = makeProfile(['unknown'], configDir)
    const errorMsg = await runExpectingError(cmd)
    expect(errorMsg).to.include('No spec found with name "unknown"')
  })

  describe('default (list profiles)', () => {
    it('shows "No profiles found" when spec has no profiles', async () => {
      const configDir = await freshConfig()
      const {cmd, output} = makeProfile(['petstore'], configDir)
      await cmd.run()
      expect(output()).to.include('No profiles found')
    })

    it('lists all profiles with active marker and base URLs', async () => {
      const configDir = await freshConfig()
      await withProfiles(configDir)
      const {cmd, output} = makeProfile(['petstore'], configDir)
      await cmd.run()
      const out = output()
      expect(out).to.include('dev')
      expect(out).to.include('prod')
      expect(out).to.include('*')
      expect(out).to.include('https://dev.example.com')
    })
  })

  describe('--show', () => {
    it('shows redacted auth detail for a named profile', async () => {
      const configDir = await freshConfig()
      await withProfiles(configDir)
      const {cmd, output} = makeProfile(['petstore', '--show', 'dev'], configDir)
      await cmd.run()
      const out = output()
      expect(out).to.include('dev')
      expect(out).to.not.include('tok-dev')
      expect(out).to.include('***')
    })

    it('errors when profile not found', async () => {
      const configDir = await freshConfig()
      const {cmd} = makeProfile(['petstore', '--show', 'missing'], configDir)
      const errorMsg = await runExpectingError(cmd)
      expect(errorMsg).to.include('No profile "missing" found')
    })
  })

  describe('--use', () => {
    it('activates a named profile and updates spec.auth and spec.baseUrl', async () => {
      const configDir = await freshConfig()
      await withProfiles(configDir) // prod is active
      const {cmd} = makeProfile(['petstore', '--use', 'dev'], configDir)
      await cmd.run()

      const store = await readStore(configDir)
      const spec = store.specs.petstore
      expect(spec.activeProfile).to.equal('dev')
      expect(spec.auth.type).to.equal('http')
      if (spec.auth.type === 'http') expect(spec.auth.token).to.equal('tok-dev')
      expect(spec.baseUrl).to.equal('https://dev.example.com')
    })

    it('errors when profile not found', async () => {
      const configDir = await freshConfig()
      const {cmd} = makeProfile(['petstore', '--use', 'missing'], configDir)
      const errorMsg = await runExpectingError(cmd)
      expect(errorMsg).to.include('No profile "missing" found')
    })
  })

  describe('--delete', () => {
    it('removes a named profile', async () => {
      const configDir = await freshConfig()
      await withProfiles(configDir)
      const {cmd} = makeProfile(['petstore', '--delete', 'dev'], configDir)
      await cmd.run()

      const store = await readStore(configDir)
      expect(store.specs.petstore.authProfiles?.dev).to.be.undefined
    })

    it('clears activeProfile when deleting the active profile', async () => {
      const configDir = await freshConfig()
      await withProfiles(configDir) // prod is active
      const {cmd} = makeProfile(['petstore', '--delete', 'prod'], configDir)
      await cmd.run()

      const store = await readStore(configDir)
      expect(store.specs.petstore.activeProfile).to.be.undefined
    })

    it('errors when profile not found', async () => {
      const configDir = await freshConfig()
      const {cmd} = makeProfile(['petstore', '--delete', 'missing'], configDir)
      const errorMsg = await runExpectingError(cmd)
      expect(errorMsg).to.include('No profile "missing" found')
    })
  })
})
