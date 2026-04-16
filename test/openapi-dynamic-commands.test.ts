import type {Config} from '@oclif/core/interfaces'

import {Command} from '@oclif/core'
import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {registerOpenApiCommands} from '../src/openapi-dynamic-commands.js'
import {deleteSpec, type OpenApiStore, writeStore} from '../src/openapi-store.js'

// ─── Types ────────────────────────────────────────────────────────────────────

type FetchLike = (
  url: string,
  init?: {body?: null | string; headers?: Record<string, string>; method?: string},
) => Promise<{ok: boolean; status: number; statusText: string; text: () => Promise<string>}>

type FetchCall = {body?: string; headers: Record<string, string>; method: string; url: string}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FIXTURE_STORE: OpenApiStore = {
  specs: {
    petstore: {
      auth: {type: 'none'},
      baseUrl: 'https://petstore.example.com',
      description: 'A sample API that describes pets',
      name: 'petstore',
      operations: [
        {
          bodyParams: {},
          description: 'List all pets',
          method: 'get',
          operationId: 'listPets',
          parameters: [
            {description: 'Max results', in: 'query', name: 'limit', required: false, schema: {type: 'integer'}},
          ],
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
        {
          bodyParams: {},
          description: 'Get pet by ID',
          method: 'get',
          operationId: 'showPetById',
          parameters: [{in: 'path', name: 'petId', required: true, schema: {type: 'string'}}],
          path: '/pets/{petId}',
        },
        {
          // body param 'petId' collides with path param 'petId' → exposed as --body-petId
          bodyParams: {petId: {description: 'Replacement ID', required: false, type: 'string'}},
          description: 'Update pet by ID',
          method: 'patch',
          operationId: 'updatePetById',
          parameters: [{in: 'path', name: 'petId', required: true, schema: {type: 'string'}}],
          path: '/pets/{petId}',
        },
        {
          bodyParams: {},
          description: 'Upload a file',
          method: 'put',
          operationId: 'uploadFile',
          parameters: [{in: 'path', name: 'filename', required: true, schema: {type: 'string'}}],
          path: '/files/{filename}',
          rawBodyContentType: 'text/markdown',
        },
      ],
      source: './petstore.json',
      title: 'Petstore',
    },
    'secure-api': {
      auth: {scheme: 'bearer', token: 'my-token', type: 'http'},
      baseUrl: 'https://secure.example.com',
      description: '',
      name: 'secure-api',
      operations: [
        {
          bodyParams: {},
          description: 'Get profile',
          method: 'get',
          operationId: 'getProfile',
          parameters: [],
          path: '/profile',
        },
      ],
      source: './secure.json',
      title: 'Secure API',
    },
  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMockFetch(status: number, responseBody: string): {calls: FetchCall[]; mockFetch: FetchLike} {
  const calls: FetchCall[] = []
  const mockFetch: FetchLike = async (url, init?) => {
    calls.push({
      body: init?.body as string | undefined,
      headers: (init?.headers as Record<string, string>) ?? {},
      method: init?.method ?? 'GET',
      url,
    })
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      text: async () => responseBody,
    }
  }

  return {calls, mockFetch}
}

type LoadableCommand = {
  description?: string
  hidden: boolean
  id: string
  load: () => Promise<typeof Command>
}

type InternalConfig = {
  _commands: Map<string, LoadableCommand>
  _topics: Map<string, {description?: string; hidden: boolean; name: string}>
  configDir: string
  name: string
}

function makeInternalConfig(configDir: string): InternalConfig {
  return {
    _commands: new Map(),
    _topics: new Map(),
    configDir,
    name: 'sdkck',
  }
}

describe('openapi-dynamic-commands', () => {
  // ─── registerOpenApiCommands ──────────────────────────────────────────────────

  describe('registerOpenApiCommands', () => {
    let tmpDir: string
    let configDir: string
    let ic: InternalConfig

    before(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-test-'))
      configDir = join(tmpDir, 'config')
      await writeStore(configDir, FIXTURE_STORE)
      ic = makeInternalConfig(configDir)
      await registerOpenApiCommands(ic as unknown as Config)
    })

    after(async () => {
      await rm(tmpDir, {recursive: true})
    })

    it('registers a command for every operation', () => {
      expect(ic._commands.has('petstore:listPets')).to.be.true
      expect(ic._commands.has('petstore:createPet')).to.be.true
      expect(ic._commands.has('petstore:showPetById')).to.be.true
      expect(ic._commands.has('petstore:updatePetById')).to.be.true
      expect(ic._commands.has('secure-api:getProfile')).to.be.true
    })

    it('sets correct command id, description, and hidden flag', () => {
      const entry = ic._commands.get('petstore:listPets')!
      expect(entry.id).to.equal('petstore:listPets')
      expect(entry.description).to.equal('List all pets')
      expect(entry.hidden).to.be.false
    })

    it('registers a topic per spec with description from spec.description', () => {
      expect(ic._topics.has('petstore')).to.be.true
      const topic = ic._topics.get('petstore')!
      expect(topic.name).to.equal('petstore')
      expect(topic.description).to.equal('A sample API that describes pets')
      expect(topic.hidden).to.be.false
    })

    it('falls back to spec.title for topic description when spec.description is empty', () => {
      const topic = ic._topics.get('secure-api')!
      expect(topic.description).to.equal('Secure API')
    })

    it('does not overwrite an existing command entry', async () => {
      const ic2 = makeInternalConfig(configDir)
      const sentinel = {id: 'petstore:listPets', load: async () => Command}
      ic2._commands.set('petstore:listPets', sentinel as never)
      await registerOpenApiCommands(ic2 as unknown as Config)
      expect(ic2._commands.get('petstore:listPets')).to.equal(sentinel)
    })

    it('does not overwrite an existing topic entry', async () => {
      const ic2 = makeInternalConfig(configDir)
      const sentinel = {description: 'custom', hidden: true, name: 'petstore'}
      ic2._topics.set('petstore', sentinel)
      await registerOpenApiCommands(ic2 as unknown as Config)
      expect(ic2._topics.get('petstore')).to.equal(sentinel)
    })

    it('registers nothing for an empty store', async () => {
      const emptyDir = join(tmpDir, 'config-empty')
      const ic2 = makeInternalConfig(emptyDir)
      await registerOpenApiCommands(ic2 as unknown as Config)
      expect(ic2._commands.size).to.equal(0)
      expect(ic2._topics.size).to.equal(0)
    })
  })

  // ─── DynamicOperationCommand execution ───────────────────────────────────────

  describe('DynamicOperationCommand', () => {
    let tmpDir: string
    let configDir: string
    let commandMap: Map<string, {load: () => Promise<typeof Command>}>

    before(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-test-'))
      configDir = join(tmpDir, 'config')
      await writeStore(configDir, FIXTURE_STORE)
      const ic = makeInternalConfig(configDir)
      await registerOpenApiCommands(ic as unknown as Config)
      commandMap = ic._commands
    })

    after(async () => {
      await rm(tmpDir, {recursive: true})
    })

    async function makeCmd(
      commandId: string,
      argv: string[],
      overrideConfigDir?: string,
    ): Promise<{cmd: Command & {_fetch: FetchLike}; output: () => string; warnings: () => string[]}> {
      const entry = commandMap.get(commandId)
      if (!entry) throw new Error(`Command "${commandId}" not found`)
      const CmdClass = await entry.load()
      const cmdConfig = {
        bin: 'sdkck',
        configDir: overrideConfigDir ?? configDir,
        runHook: async () => ({failures: [], successes: []}),
      } as never

      const lines: string[] = []
      const warnLines: string[] = []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cmd = new (CmdClass as any)(argv, cmdConfig) as Command & {_fetch: FetchLike}
      cmd.log = (message = '') => {
        lines.push(String(message))
      }

      cmd.warn = (message: Error | string) => {
        warnLines.push(String(message))
        return message as string
      }

      return {cmd, output: () => lines.join('\n'), warnings: () => warnLines}
    }

    it('makes a GET request with no parameters', async () => {
      const {calls, mockFetch} = makeMockFetch(200, '[]')
      const {cmd} = await makeCmd('petstore:listPets', [])
      cmd._fetch = mockFetch
      await cmd.run()
      expect(calls).to.have.length(1)
      expect(calls[0].method).to.equal('GET')
      expect(calls[0].url).to.equal('https://petstore.example.com/pets')
    })

    it('appends an optional query param provided via a flag', async () => {
      const {calls, mockFetch} = makeMockFetch(200, '[]')
      const {cmd} = await makeCmd('petstore:listPets', ['--limit', '5'])
      cmd._fetch = mockFetch
      await cmd.run()
      expect(calls[0].url).to.equal('https://petstore.example.com/pets?limit=5')
    })

    it('interpolates a required path param provided as a positional arg', async () => {
      const {calls, mockFetch} = makeMockFetch(200, '{"id":42}')
      const {cmd} = await makeCmd('petstore:showPetById', ['42'])
      cmd._fetch = mockFetch
      await cmd.run()
      expect(calls[0].method).to.equal('GET')
      expect(calls[0].url).to.equal('https://petstore.example.com/pets/42')
    })

    it('sends a required body param provided as a positional arg', async () => {
      const {calls, mockFetch} = makeMockFetch(201, '{"id":1}')
      const {cmd} = await makeCmd('petstore:createPet', ['Fido'])
      cmd._fetch = mockFetch
      await cmd.run()
      expect(calls[0].method).to.equal('POST')
      expect(calls[0].headers['Content-Type']).to.equal('application/json')
      const body = JSON.parse(calls[0].body!)
      expect(body.name).to.equal('Fido')
      expect(body).not.to.have.property('tag')
    })

    it('includes an optional body param when provided via a flag', async () => {
      const {calls, mockFetch} = makeMockFetch(201, '{"id":2}')
      const {cmd} = await makeCmd('petstore:createPet', ['Fido', '--tag', 'dog'])
      cmd._fetch = mockFetch
      await cmd.run()
      const body = JSON.parse(calls[0].body!)
      expect(body).to.deep.equal({name: 'Fido', tag: 'dog'})
    })

    it('includes bearer auth header for specs with HTTP bearer auth', async () => {
      const {calls, mockFetch} = makeMockFetch(200, '{"user":"alice"}')
      const {cmd} = await makeCmd('secure-api:getProfile', [])
      cmd._fetch = mockFetch
      await cmd.run()
      expect(calls[0].headers.Authorization).to.equal('Bearer my-token')
    })

    it('includes extra request headers from --header flag', async () => {
      const {calls, mockFetch} = makeMockFetch(200, '[]')
      const {cmd} = await makeCmd('petstore:listPets', ['--header', 'X-Trace=abc'])
      cmd._fetch = mockFetch
      await cmd.run()
      expect(calls[0].headers['X-Trace']).to.equal('abc')
    })

    it('prefixes colliding body param name with body- and sends correct value', async () => {
      const {calls, mockFetch} = makeMockFetch(200, '{}')
      // petId is both a required path param (positional) and an optional body param (--body-petId)
      const {cmd} = await makeCmd('petstore:updatePetById', ['42', '--body-petId', 'newid'])
      cmd._fetch = mockFetch
      await cmd.run()
      expect(calls[0].url).to.equal('https://petstore.example.com/pets/42')
      const body = JSON.parse(calls[0].body!)
      expect(body.petId).to.equal('newid')
    })

    it('sends raw body with correct Content-Type via --body flag', async () => {
      const {calls, mockFetch} = makeMockFetch(204, '')
      const {cmd} = await makeCmd('petstore:uploadFile', ['notes.md', '--body', '# Hello'])
      cmd._fetch = mockFetch
      await cmd.run()
      expect(calls[0].method).to.equal('PUT')
      expect(calls[0].url).to.equal('https://petstore.example.com/files/notes.md')
      expect(calls[0].body).to.equal('# Hello')
      expect(calls[0].headers['Content-Type']).to.equal('text/markdown')
    })

    it('allows --header to override the inferred Content-Type for raw body ops', async () => {
      const {calls, mockFetch} = makeMockFetch(204, '')
      const {cmd} = await makeCmd('petstore:uploadFile', [
        'notes.md',
        '--body',
        '# Hello',
        '--header',
        'Content-Type=text/plain',
      ])
      cmd._fetch = mockFetch
      await cmd.run()
      expect(calls[0].headers['Content-Type']).to.equal('text/plain')
    })

    it('does not override user Content-Type for JSON body ops', async () => {
      const {calls, mockFetch} = makeMockFetch(201, '{"id":1}')
      const {cmd} = await makeCmd('petstore:createPet', ['Fido', '--header', 'Content-Type=application/vnd.api+json'])
      cmd._fetch = mockFetch
      await cmd.run()
      expect(calls[0].headers['Content-Type']).to.equal('application/vnd.api+json')
    })

    it('pretty-prints a valid JSON response', async () => {
      const {mockFetch} = makeMockFetch(200, '[{"id":1,"name":"Fido"}]')
      const {cmd, output} = await makeCmd('petstore:listPets', [])
      cmd._fetch = mockFetch
      await cmd.run()
      expect(output()).to.include('"name": "Fido"')
    })

    it('prints a non-JSON response as-is', async () => {
      const raw = 'plain text response'
      const {mockFetch} = makeMockFetch(200, raw)
      const {cmd, output} = await makeCmd('petstore:listPets', [])
      cmd._fetch = mockFetch
      await cmd.run()
      expect(output()).to.include(raw)
    })

    it('emits a warning on non-2xx HTTP status', async () => {
      const {mockFetch} = makeMockFetch(500, '{"error":"oops"}')
      const {cmd, warnings} = await makeCmd('petstore:listPets', [])
      cmd._fetch = mockFetch
      await cmd.run()
      expect(warnings()[0]).to.include('500')
    })

    it('errors when the spec has been removed after registration', async () => {
      const altDir = join(tmpDir, 'config-deleted')
      const deletedStore: OpenApiStore = {
        specs: {
          tmpspec: {
            auth: {type: 'none'},
            baseUrl: 'https://example.com',
            description: '',
            name: 'tmpspec',
            operations: [
              {bodyParams: {}, description: 'Ping', method: 'get', operationId: 'ping', parameters: [], path: '/ping'},
            ],
            source: './tmp.json',
            title: 'Tmp',
          },
        },
      }
      await writeStore(altDir, deletedStore)
      const ic = makeInternalConfig(altDir)
      await registerOpenApiCommands(ic as unknown as Config)

      await deleteSpec(altDir, 'tmpspec')

      const entry = ic._commands.get('tmpspec:ping')!
      const CmdClass = await entry.load()
      const cmdConfig = {bin: 'sdkck', configDir: altDir, runHook: async () => ({failures: [], successes: []})} as never
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cmd = new (CmdClass as any)([], cmdConfig) as Command & {_fetch: FetchLike}
      cmd._fetch = makeMockFetch(200, '').mockFetch
      let errorMsg = ''
      cmd.error = (msg: Error | string) => {
        errorMsg = String(msg)
        throw new Error(errorMsg)
      }

      await cmd.run().catch(() => {})
      expect(errorMsg).to.include('tmpspec')
    })

    it('errors when no base URL is configured on the spec', async () => {
      const altDir = join(tmpDir, 'config-nobaseurl')
      const noUrlStore: OpenApiStore = {
        specs: {
          nourl: {
            auth: {type: 'none'},
            baseUrl: '',
            description: '',
            name: 'nourl',
            operations: [
              {bodyParams: {}, description: 'Ping', method: 'get', operationId: 'ping', parameters: [], path: '/ping'},
            ],
            source: './nourl.json',
            title: 'No URL',
          },
        },
      }
      await writeStore(altDir, noUrlStore)
      const ic = makeInternalConfig(altDir)
      await registerOpenApiCommands(ic as unknown as Config)

      const entry = ic._commands.get('nourl:ping')!
      const CmdClass = await entry.load()
      const cmdConfig = {bin: 'sdkck', configDir: altDir, runHook: async () => ({failures: [], successes: []})} as never
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cmd = new (CmdClass as any)([], cmdConfig) as Command & {_fetch: FetchLike}
      let errorMsg = ''
      cmd.error = (msg: Error | string) => {
        errorMsg = String(msg)
        throw new Error(errorMsg)
      }

      await cmd.run().catch(() => {})
      expect(errorMsg).to.include('base URL')
    })
  })
}) // end openapi-dynamic-commands
