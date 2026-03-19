import {expect} from 'chai'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import OpenApiImport from '../../../src/commands/openapi/import.js'
import {readStore} from '../../../src/openapi-store.js'

const PETSTORE_SPEC = {
  info: {description: 'A sample API', title: 'Petstore', version: '1.0.0'},
  openapi: '3.0.0',
  paths: {
    '/pets': {
      get: {
        description: 'List all pets',
        operationId: 'listPets',
        parameters: [{in: 'query', name: 'limit', required: false, schema: {type: 'integer'}}],
        summary: 'List all pets',
      },
      post: {
        description: 'Create a pet',
        operationId: 'createPet',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                properties: {name: {type: 'string'}, tag: {type: 'string'}},
                required: ['name'],
                type: 'object',
              },
            },
          },
        },
        summary: 'Create a pet',
      },
    },
    '/pets/{petId}': {
      get: {
        description: 'Get a pet by ID',
        operationId: 'showPetById',
        parameters: [{in: 'path', name: 'petId', required: true, schema: {type: 'string'}}],
        summary: 'Info for a specific pet',
      },
    },
  },
  servers: [{url: 'https://petstore.example.com'}],
}

function makeImport(argv: string[], configDir: string): {cmd: OpenApiImport; output: () => string} {
  const lines: string[] = []
  const warnings: string[] = []
  const config = {
    bin: 'sdkck',
    configDir,
    runHook: async () => ({failures: [], successes: []}),
  } as never

  const cmd = new OpenApiImport(argv, config)
  cmd.log = (message = '') => {
    lines.push(String(message))
  }

  cmd.warn = (message: Error | string) => {
    warnings.push(String(message))
    return message as string
  }

  return {cmd, output: () => lines.join('\n')}
}

describe('openapi import', () => {
  let tmpDir: string
  let specFile: string

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-test-'))
    specFile = join(tmpDir, 'petstore.json')
    await writeFile(specFile, JSON.stringify(PETSTORE_SPEC), 'utf8')
  })

  after(async () => {
    await rm(tmpDir, {recursive: true})
  })

  it('imports a JSON spec file and reports operation count', async () => {
    const configDir = join(tmpDir, 'config-import-1')
    const {cmd, output} = makeImport([specFile], configDir)
    await cmd.run()

    const out = output()
    expect(out).to.include('Petstore')
    expect(out).to.include('3') // 3 operations
    expect(out).to.include('petstore')
  })

  it('saves spec to the store with correct name slug', async () => {
    const configDir = join(tmpDir, 'config-import-2')
    const {cmd} = makeImport([specFile], configDir)
    await cmd.run()

    const store = await readStore(configDir)
    expect(store.specs).to.have.key('petstore')
    expect(store.specs.petstore.operations).to.have.length(3)
  })

  it('uses --name flag to override the slug', async () => {
    const configDir = join(tmpDir, 'config-import-3')
    const {cmd} = makeImport([specFile, '--name', 'myapi'], configDir)
    await cmd.run()

    const store = await readStore(configDir)
    expect(store.specs).to.have.key('myapi')
  })

  it('stores bearer auth when --auth-type bearer --token is given', async () => {
    const configDir = join(tmpDir, 'config-import-4')
    const {cmd} = makeImport([specFile, '--auth-type', 'bearer', '--token', 'tok123'], configDir)
    await cmd.run()

    const store = await readStore(configDir)
    const {auth} = store.specs.petstore
    expect(auth.type).to.equal('http')

    if (auth.type === 'http') {
      expect(auth.token).to.equal('tok123')
    }
  })

  it('stores apikey auth when --auth-type apikey is given', async () => {
    const configDir = join(tmpDir, 'config-import-5')
    const {cmd} = makeImport([specFile, '--auth-type', 'apikey', '--api-key', 'key42'], configDir)
    await cmd.run()

    const store = await readStore(configDir)
    const {auth} = store.specs.petstore
    expect(auth.type).to.equal('apikey')

    if (auth.type === 'apikey') {
      expect(auth.apiKey).to.equal('key42')
      expect(auth.header).to.equal('X-API-Key')
    }
  })

  it('stores basic auth when --auth-type basic is given', async () => {
    const configDir = join(tmpDir, 'config-import-6')
    const {cmd} = makeImport(
      [specFile, '--auth-type', 'basic', '--username', 'alice', '--password', 'secret'],
      configDir,
    )
    await cmd.run()

    const store = await readStore(configDir)
    const {auth} = store.specs.petstore
    expect(auth.type).to.equal('basic')

    if (auth.type === 'basic') {
      expect(auth.username).to.equal('alice')
    }
  })

  it('uses --base-url flag to override server URL', async () => {
    const configDir = join(tmpDir, 'config-import-7')
    const {cmd} = makeImport([specFile, '--base-url', 'https://staging.example.com'], configDir)
    await cmd.run()

    const store = await readStore(configDir)
    expect(store.specs.petstore.baseUrl).to.equal('https://staging.example.com')
  })
})
