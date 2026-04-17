import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {type ApiStore, writeStore} from '../../../src/api-store.js'
import ApiList from '../../../src/commands/api/list.js'

const FIXTURE_STORE: ApiStore = {
  specs: {
    petstore: {
      auth: {type: 'none'},
      baseUrl: 'https://petstore.example.com',
      description: 'A sample API',
      name: 'petstore',
      operations: [
        {
          bodyParams: {},
          description: 'List all pets',
          method: 'get',
          operationId: 'listPets',
          parameters: [{in: 'query', name: 'limit', required: false, schema: {type: 'integer'}}],
          path: '/pets',
        },
        {
          bodyParams: {name: {required: true, type: 'string'}, tag: {required: false, type: 'string'}},
          description: 'Create a pet',
          method: 'post',
          operationId: 'createPet',
          parameters: [],
          path: '/pets',
        },
      ],
      source: './petstore.json',
      title: 'Petstore',
    },
  },
}

function makeList(argv: string[], configDir: string): {cmd: ApiList; output: () => string} {
  const lines: string[] = []
  const config = {
    bin: 'sdkck',
    configDir,
    runHook: async () => ({failures: [], successes: []}),
  } as never

  const cmd = new ApiList(argv, config)
  cmd.log = (message = '') => {
    lines.push(String(message))
  }

  return {cmd, output: () => lines.join('\n')}
}

describe('api list', () => {
  let tmpDir: string

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-test-'))
  })

  after(async () => {
    await rm(tmpDir, {recursive: true})
  })

  it('shows a message when no specs are imported', async () => {
    const configDir = join(tmpDir, 'config-list-empty')
    const {cmd, output} = makeList([], configDir)
    await cmd.run()
    expect(output()).to.include('No API specs imported')
  })

  it('lists imported specs when no name argument is given', async () => {
    const configDir = join(tmpDir, 'config-list-all')
    await writeStore(configDir, FIXTURE_STORE)

    const {cmd, output} = makeList([], configDir)
    await cmd.run()
    const out = output()
    expect(out).to.include('petstore')
    expect(out).to.include('Petstore')
    expect(out).to.include('2 operations')
  })

  it('lists operations for a named spec', async () => {
    const configDir = join(tmpDir, 'config-list-named')
    await writeStore(configDir, FIXTURE_STORE)

    const {cmd, output} = makeList(['petstore'], configDir)
    await cmd.run()
    const out = output()
    expect(out).to.include('listPets')
    expect(out).to.include('createPet')
    expect(out).to.include('/pets')
  })

  it('shows param hints including required markers', async () => {
    const configDir = join(tmpDir, 'config-list-params')
    await writeStore(configDir, FIXTURE_STORE)

    const {cmd, output} = makeList(['petstore'], configDir)
    await cmd.run()
    const out = output()
    // required body param for createPet should be shown with angle brackets
    expect(out).to.include('<name>')
    // optional body param
    expect(out).to.include('[tag]')
  })
})
