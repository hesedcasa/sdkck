import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import OpenApiConfig from '../../../src/commands/openapi/config.js'
import {type OpenApiStore, readStore, writeStore} from '../../../src/openapi-store.js'

const FIXTURE_STORE: OpenApiStore = {
  specs: {
    petstore: {
      auth: {type: 'none'},
      baseUrl: 'https://petstore.example.com',
      description: 'A sample API',
      name: 'petstore',
      operations: [],
      source: './petstore.json',
      title: 'Petstore',
    },
  },
}

function makeConfig(argv: string[], configDir: string): {cmd: OpenApiConfig; output: () => string} {
  const lines: string[] = []
  const config = {
    bin: 'sdkck',
    configDir,
    runHook: async () => ({failures: [], successes: []}),
  } as never

  const cmd = new OpenApiConfig(argv, config)
  cmd.log = (message = '') => {
    lines.push(String(message))
  }

  return {cmd, output: () => lines.join('\n')}
}

async function runExpectingError(cmd: OpenApiConfig): Promise<string> {
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

describe('openapi config', () => {
  let tmpDir: string

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-test-'))
  })

  after(async () => {
    await rm(tmpDir, {recursive: true})
  })

  async function freshConfig(): Promise<string> {
    const configDir = join(tmpDir, `config-${Date.now()}`)
    await writeStore(configDir, FIXTURE_STORE)
    return configDir
  }

  it('errors when no flags are provided', async () => {
    const configDir = await freshConfig()
    const {cmd} = makeConfig(['petstore'], configDir)
    const errorMsg = await runExpectingError(cmd)
    expect(errorMsg).to.include('Provide at least one flag')
  })

  it('errors when spec is not found', async () => {
    const configDir = await freshConfig()
    const {cmd} = makeConfig(['unknown', '--base-url', 'https://example.com'], configDir)
    const errorMsg = await runExpectingError(cmd)
    expect(errorMsg).to.include('No spec found with name "unknown"')
  })

  it('updates base-url', async () => {
    const configDir = await freshConfig()
    const {cmd} = makeConfig(['petstore', '--base-url', 'https://new.example.com'], configDir)
    await cmd.run()

    const store = await readStore(configDir)
    expect(store.specs.petstore.baseUrl).to.equal('https://new.example.com')
  })

  it('updates title', async () => {
    const configDir = await freshConfig()
    const {cmd} = makeConfig(['petstore', '--title', 'New Title'], configDir)
    await cmd.run()

    const store = await readStore(configDir)
    expect(store.specs.petstore.title).to.equal('New Title')
  })

  it('updates description', async () => {
    const configDir = await freshConfig()
    const {cmd} = makeConfig(['petstore', '--description', 'Updated description'], configDir)
    await cmd.run()

    const store = await readStore(configDir)
    expect(store.specs.petstore.description).to.equal('Updated description')
  })

  it('renames the spec', async () => {
    const configDir = await freshConfig()
    const {cmd} = makeConfig(['petstore', '--rename', 'newstore'], configDir)
    await cmd.run()

    const store = await readStore(configDir)
    expect(store.specs.newstore).to.exist
    expect(store.specs.newstore.name).to.equal('newstore')
    expect(store.specs.petstore).to.be.undefined
  })

  it('errors when rename target already exists', async () => {
    const configDir = await freshConfig()
    const store = await readStore(configDir)
    store.specs.other = {...FIXTURE_STORE.specs.petstore, name: 'other'}
    await writeStore(configDir, store)

    const {cmd} = makeConfig(['petstore', '--rename', 'other'], configDir)
    const errorMsg = await runExpectingError(cmd)
    expect(errorMsg).to.include('A spec named "other" already exists')
  })

  it('updates multiple fields at once', async () => {
    const configDir = await freshConfig()
    const {cmd} = makeConfig(
      ['petstore', '--base-url', 'https://api.example.com', '--title', 'My API', '--description', 'My description'],
      configDir,
    )
    await cmd.run()

    const store = await readStore(configDir)
    const spec = store.specs.petstore
    expect(spec.baseUrl).to.equal('https://api.example.com')
    expect(spec.title).to.equal('My API')
    expect(spec.description).to.equal('My description')
  })
})
