import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import OpenApiRemove from '../../../src/commands/openapi/remove.js'
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

function makeRemove(argv: string[], configDir: string): {cmd: OpenApiRemove; output: () => string} {
  const lines: string[] = []
  const config = {
    bin: 'sdkck',
    configDir,
    runHook: async () => ({failures: [], successes: []}),
  } as never

  const cmd = new OpenApiRemove(argv, config)
  cmd.log = (message = '') => {
    lines.push(String(message))
  }

  return {cmd, output: () => lines.join('\n')}
}

describe('openapi remove', () => {
  let tmpDir: string

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-test-'))
  })

  after(async () => {
    await rm(tmpDir, {recursive: true})
  })

  async function freshConfig(): Promise<string> {
    const configDir = join(tmpDir, `config-remove-${Date.now()}`)
    await writeStore(configDir, FIXTURE_STORE)
    return configDir
  }

  it('removes an existing spec and confirms', async () => {
    const configDir = await freshConfig()
    const {cmd, output} = makeRemove(['petstore'], configDir)
    await cmd.run()
    expect(output()).to.include('Removed "petstore"')
  })

  it('spec is no longer returned by readStore after removal', async () => {
    const configDir = await freshConfig()
    await makeRemove(['petstore'], configDir).cmd.run()
    const store = await readStore(configDir)
    expect(store.specs).to.not.have.key('petstore')
  })

  it('errors when the spec does not exist', async () => {
    const configDir = await freshConfig()
    const {cmd} = makeRemove(['nonexistent'], configDir)
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

    expect(errorMsg).to.include('No spec found with name "nonexistent"')
  })
})
