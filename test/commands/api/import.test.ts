import {expect} from 'chai'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {readStore} from '../../../src/api-store.js'
import ApiImport from '../../../src/commands/api/import.js'

const POSTMAN_COLLECTION = {
  info: {
    _postman_id: 'test-123', // eslint-disable-line camelcase
    description: 'A sample Petstore via Postman',
    name: 'Petstore Postman',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: [
    {
      name: 'List Pets',
      request: {
        description: 'List all pets',
        method: 'GET',
        url: {
          host: ['petstore', 'example', 'com'],
          path: ['pets'],
          query: [{key: 'limit', value: '10'}],
          raw: 'https://petstore.example.com/pets?limit=10',
        },
      },
    },
    {
      name: 'Create Pet',
      request: {
        body: {mode: 'raw', raw: '{"name": "Fido"}'},
        method: 'POST',
        url: {
          host: ['petstore', 'example', 'com'],
          path: ['pets'],
          raw: 'https://petstore.example.com/pets',
        },
      },
    },
    {
      name: 'Get Pet',
      request: {
        method: 'GET',
        url: {
          host: ['petstore', 'example', 'com'],
          path: ['pets', ':petId'],
          raw: 'https://petstore.example.com/pets/:petId',
          variable: [{key: 'petId', value: '1'}],
        },
      },
    },
  ],
}

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

function makeImport(argv: string[], configDir: string): {cmd: ApiImport; output: () => string} {
  const lines: string[] = []
  const warnings: string[] = []
  const config = {
    bin: 'sdkck',
    configDir,
    runHook: async () => ({failures: [], successes: []}),
  } as never

  const cmd = new ApiImport(argv, config)
  cmd.log = (message = '') => {
    lines.push(String(message))
  }

  cmd.warn = (message: Error | string) => {
    warnings.push(String(message))
    return message as string
  }

  return {cmd, output: () => lines.join('\n')}
}

describe('api import', () => {
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

  it('imports a Postman collection and converts to operations', async () => {
    const configDir = join(tmpDir, 'config-import-postman-1')
    const postmanFile = join(tmpDir, 'petstore_postman.json')
    await writeFile(postmanFile, JSON.stringify(POSTMAN_COLLECTION), 'utf8')

    const {cmd, output} = makeImport([postmanFile], configDir)
    await cmd.run()

    const out = output()
    expect(out).to.include('Petstore Postman')
    expect(out).to.include('3') // 3 operations

    const store = await readStore(configDir)
    expect(store.specs).to.have.key('petstore-postman')
    expect(store.specs['petstore-postman'].operations).to.have.length(3)
  })

  it('uses --name flag to override slug for Postman collection', async () => {
    const configDir = join(tmpDir, 'config-import-postman-2')
    const postmanFile = join(tmpDir, 'petstore_postman2.json')
    await writeFile(postmanFile, JSON.stringify(POSTMAN_COLLECTION), 'utf8')

    const {cmd} = makeImport([postmanFile, '--name', 'mypets'], configDir)
    await cmd.run()

    const store = await readStore(configDir)
    expect(store.specs).to.have.key('mypets')
  })

  it('extracts base URL from Postman collection', async () => {
    const configDir = join(tmpDir, 'config-import-postman-3')
    const postmanFile = join(tmpDir, 'petstore_postman3.json')
    await writeFile(postmanFile, JSON.stringify(POSTMAN_COLLECTION), 'utf8')

    const {cmd} = makeImport([postmanFile], configDir)
    await cmd.run()

    const store = await readStore(configDir)
    expect(store.specs['petstore-postman'].baseUrl).to.equal('https://petstore.example.com')
  })

  it('errors when importing with a name that already exists', async () => {
    const configDir = join(tmpDir, 'config-import-duplicate')
    const {cmd: cmd1} = makeImport([specFile], configDir)
    await cmd1.run()

    const {cmd: cmd2} = makeImport([specFile], configDir)
    try {
      await cmd2.run()
      expect.fail('Expected an error to be thrown')
    } catch (error) {
      expect((error as Error).message).to.include('"petstore" already exists')
    }
  })

  it('allows --base-url to override Postman collection base URL', async () => {
    const configDir = join(tmpDir, 'config-import-postman-4')
    const postmanFile = join(tmpDir, 'petstore_postman4.json')
    await writeFile(postmanFile, JSON.stringify(POSTMAN_COLLECTION), 'utf8')

    const {cmd} = makeImport([postmanFile, '--base-url', 'https://staging.example.com'], configDir)
    await cmd.run()

    const store = await readStore(configDir)
    expect(store.specs['petstore-postman'].baseUrl).to.equal('https://staging.example.com')
  })

  describe('graphql import', () => {
    const SDL = `
      type Pet {
        id: ID!
        name: String!
        tag: String
      }

      input PetInput {
        name: String!
        tag: String
      }

      type Query {
        pet(id: ID!): Pet
        pets(limit: Int): [Pet!]!
      }

      type Mutation {
        createPet(input: PetInput!): Pet!
        deletePet(id: ID!): Boolean!
      }
    `

    it('auto-detects .graphql extension and imports operations', async () => {
      const configDir = join(tmpDir, 'config-import-gql-1')
      const sdlFile = join(tmpDir, 'schema.graphql')
      await writeFile(sdlFile, SDL, 'utf8')

      const {cmd, output} = makeImport([sdlFile, '--base-url', 'https://api.example.com/graphql'], configDir)
      await cmd.run()

      const out = output()
      expect(out).to.include('[graphql]')
      expect(out).to.include('4') // 4 operations

      const store = await readStore(configDir)
      expect(store.specs).to.have.key('graphql-api')
      expect(store.specs['graphql-api'].kind).to.equal('graphql')
      expect(store.specs['graphql-api'].operations).to.have.length(4)
    })

    it('stores operations with correct graphql metadata', async () => {
      const configDir = join(tmpDir, 'config-import-gql-2')
      const sdlFile = join(tmpDir, 'schema2.graphql')
      await writeFile(sdlFile, SDL, 'utf8')

      const {cmd} = makeImport([sdlFile, '--base-url', 'https://api.example.com/graphql'], configDir)
      await cmd.run()

      const store = await readStore(configDir)
      const ops = store.specs['graphql-api'].operations
      const petOp = ops.find((o) => o.operationId === 'pet')!
      expect(petOp).to.exist
      expect(petOp.graphql).to.exist
      expect(petOp.graphql!.operationType).to.equal('query')
      expect(petOp.graphql!.fieldName).to.equal('pet')
      expect(petOp.graphql!.query).to.include('query queryPet')

      const createOp = ops.find((o) => o.operationId === 'createPet')!
      expect(createOp.graphql!.operationType).to.equal('mutation')
    })

    it('uses --name flag to override slug for graphql import', async () => {
      const configDir = join(tmpDir, 'config-import-gql-3')
      const sdlFile = join(tmpDir, 'schema3.graphql')
      await writeFile(sdlFile, SDL, 'utf8')

      const {cmd} = makeImport([sdlFile, '--name', 'mygql', '--base-url', 'https://api.example.com/graphql'], configDir)
      await cmd.run()

      const store = await readStore(configDir)
      expect(store.specs).to.have.key('mygql')
      expect(store.specs.mygql.operations).to.have.length(4)
    })

    it('uses --graphql flag to force graphql import of an introspection JSON file', async () => {
      const {buildSchema, getIntrospectionQuery, graphqlSync} = await import('graphql')
      const realSchema = buildSchema(SDL)
      const introResult = graphqlSync({schema: realSchema, source: getIntrospectionQuery()})

      const configDir = join(tmpDir, 'config-import-gql-4')
      const jsonFile = join(tmpDir, 'introspection.json')
      await writeFile(jsonFile, JSON.stringify(introResult), 'utf8')

      const {cmd, output} = makeImport(
        [jsonFile, '--graphql', '--name', 'petgql', '--base-url', 'https://api.example.com/graphql'],
        configDir,
      )
      await cmd.run()

      const out = output()
      expect(out).to.include('[graphql]')

      const store = await readStore(configDir)
      expect(store.specs).to.have.key('petgql')
      expect(store.specs.petgql.kind).to.equal('graphql')
      expect(store.specs.petgql.operations).to.have.length(4)
    })

    it('respects --selection-depth flag', async () => {
      // Schema with nested object types so depth capping is observable
      const nestedSdl = `
        type Owner { name: String address: Address }
        type Address { street: String city: String }
        type Query { owner: Owner }
      `
      const configDir = join(tmpDir, 'config-import-gql-5')
      const sdlFile = join(tmpDir, 'schema5.graphql')
      await writeFile(sdlFile, nestedSdl, 'utf8')

      const {cmd} = makeImport(
        [sdlFile, '--selection-depth', '1', '--base-url', 'https://api.example.com/graphql', '--name', 'depthtest'],
        configDir,
      )
      await cmd.run()

      const store = await readStore(configDir)
      const ownerOp = store.specs.depthtest.operations.find((o) => o.operationId === 'owner')!
      // At depth 1, Address (nested object) is omitted entirely; only scalars on Owner are selected.
      expect(ownerOp.graphql!.query).to.include('name')
      expect(ownerOp.graphql!.query).not.to.include('address')
      expect(ownerOp.graphql!.query).not.to.include('__typename')
    })

    it('sets baseUrl from --base-url flag', async () => {
      const configDir = join(tmpDir, 'config-import-gql-6')
      const sdlFile = join(tmpDir, 'schema6.graphql')
      await writeFile(sdlFile, SDL, 'utf8')

      const {cmd} = makeImport([sdlFile, '--base-url', 'https://gql.example.com/graphql'], configDir)
      await cmd.run()

      const store = await readStore(configDir)
      expect(store.specs['graphql-api'].baseUrl).to.equal('https://gql.example.com/graphql')
    })

    it('stores graphql kind in the spec entry', async () => {
      const configDir = join(tmpDir, 'config-import-gql-7')
      const sdlFile = join(tmpDir, 'schema7.graphql')
      await writeFile(sdlFile, SDL, 'utf8')

      const {cmd} = makeImport([sdlFile, '--base-url', 'https://api.example.com/graphql'], configDir)
      await cmd.run()

      const store = await readStore(configDir)
      expect(store.specs['graphql-api'].kind).to.equal('graphql')
      expect(store.specs['graphql-api'].source).to.equal(sdlFile)
    })
  })
})
