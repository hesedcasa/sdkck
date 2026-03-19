import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import OpenApiAuth from '../../../src/commands/openapi/auth.js'
import {type OpenApiStore, readStore, writeStore} from '../../../src/openapi-store.js'

const FIXTURE_STORE: OpenApiStore = {
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

function makeAuth(argv: string[], configDir: string): {cmd: OpenApiAuth; output: () => string} {
  const lines: string[] = []
  const config = {
    bin: 'sdkck',
    configDir,
    runHook: async () => ({failures: [], successes: []}),
  } as never

  const cmd = new OpenApiAuth(argv, config)
  cmd.log = (message = '') => {
    lines.push(String(message))
  }

  return {cmd, output: () => lines.join('\n')}
}

describe('openapi auth', () => {
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
    const {cmd} = makeAuth(['petstore', '--type', 'apikey', '--api-key', 'key99', '--api-key-header', 'X-Token'], configDir)
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
    // First set to bearer
    await makeAuth(['petstore', '--type', 'bearer', '--token', 'tok'], configDir).cmd.run()
    // Then reset
    await makeAuth(['petstore', '--type', 'none'], configDir).cmd.run()

    const store = await readStore(configDir)
    expect(store.specs.petstore.auth.type).to.equal('none')
  })

  it('--show redacts token values', async () => {
    const configDir = await freshConfig()
    await makeAuth(['petstore', '--type', 'bearer', '--token', 'supersecrettoken'], configDir).cmd.run()
    const {cmd, output} = makeAuth(['petstore', '--show'], configDir)
    await cmd.run()
    const out = output()
    expect(out).to.not.include('supersecrettoken')
    expect(out).to.include('***')
  })
})
