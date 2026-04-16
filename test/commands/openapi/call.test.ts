import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import OpenApiCall, {type FetchLike} from '../../../src/commands/openapi/call.js'
import {type OpenApiStore, writeStore} from '../../../src/openapi-store.js'

const FIXTURE_STORE: OpenApiStore = {
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
        {
          bodyParams: {},
          description: 'Get pet by ID',
          method: 'get',
          operationId: 'showPetById',
          parameters: [{in: 'path', name: 'petId', required: true, schema: {type: 'string'}}],
          path: '/pets/{petId}',
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

type FetchCall = {body?: string; headers: Record<string, string>; method: string; url: string}

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

function makeCall(
  argv: string[],
  configDir: string,
): {cmd: OpenApiCall; output: () => string; warnings: () => string[]} {
  const lines: string[] = []
  const warnLines: string[] = []
  const config = {
    bin: 'sdkck',
    configDir,
    runHook: async () => ({failures: [], successes: []}),
  } as never

  const cmd = new OpenApiCall(argv, config)
  cmd.log = (message = '') => {
    lines.push(String(message))
  }

  cmd.warn = (message: Error | string) => {
    warnLines.push(String(message))
    return message as string
  }

  return {cmd, output: () => lines.join('\n'), warnings: () => warnLines}
}

describe('openapi call', () => {
  let tmpDir: string
  let configDir: string

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-test-'))
    configDir = join(tmpDir, 'config')
    await writeStore(configDir, FIXTURE_STORE)
  })

  after(async () => {
    await rm(tmpDir, {recursive: true})
  })

  it('makes a GET request for a simple operation', async () => {
    const {calls, mockFetch} = makeMockFetch(200, JSON.stringify([{id: 1, name: 'Fido'}]))
    const {cmd} = makeCall(['petstore', 'listPets'], configDir)
    cmd._fetch = mockFetch
    await cmd.run()
    expect(calls).to.have.length(1)
    expect(calls[0].method).to.equal('GET')
    expect(calls[0].url).to.equal('https://petstore.example.com/pets')
  })

  it('appends query params to the URL', async () => {
    const {calls, mockFetch} = makeMockFetch(200, '[]')
    const {cmd} = makeCall(['petstore', 'listPets', '--param', 'limit=5'], configDir)
    cmd._fetch = mockFetch
    await cmd.run()
    expect(calls[0].url).to.equal('https://petstore.example.com/pets?limit=5')
  })

  it('interpolates path parameters', async () => {
    const {calls, mockFetch} = makeMockFetch(200, JSON.stringify({id: 42, name: 'Rex'}))
    const {cmd} = makeCall(['petstore', 'showPetById', '--param', 'petId=42'], configDir)
    cmd._fetch = mockFetch
    await cmd.run()
    expect(calls[0].url).to.equal('https://petstore.example.com/pets/42')
  })

  it('sends a JSON body for POST operations', async () => {
    const {calls, mockFetch} = makeMockFetch(201, '{"id":1,"name":"Fido"}')
    const {cmd} = makeCall(['petstore', 'createPet', '--body', 'name=Fido', '--body', 'tag=dog'], configDir)
    cmd._fetch = mockFetch
    await cmd.run()
    expect(calls[0].method).to.equal('POST')
    expect(calls[0].headers['Content-Type']).to.equal('application/json')
    const body = JSON.parse(calls[0].body!)
    expect(body).to.deep.equal({name: 'Fido', tag: 'dog'})
  })

  it('includes bearer auth header for secure specs', async () => {
    const {calls, mockFetch} = makeMockFetch(200, '{"user":"alice"}')
    const {cmd} = makeCall(['secure-api', 'getProfile'], configDir)
    cmd._fetch = mockFetch
    await cmd.run()
    expect(calls[0].headers.Authorization).to.equal('Bearer my-token')
  })

  it('prints raw response when --raw flag is set', async () => {
    const raw = 'not-json!'
    const {mockFetch} = makeMockFetch(200, raw)
    const {cmd, output} = makeCall(['petstore', 'listPets', '--raw'], configDir)
    cmd._fetch = mockFetch
    await cmd.run()
    expect(output()).to.include(raw)
  })

  it('overrides base URL with --base-url flag', async () => {
    const {calls, mockFetch} = makeMockFetch(200, '[]')
    const {cmd} = makeCall(['petstore', 'listPets', '--base-url', 'https://other.example.com'], configDir)
    cmd._fetch = mockFetch
    await cmd.run()
    expect(calls[0].url).to.include('other.example.com')
  })

  it('does not override user Content-Type header for JSON body operations', async () => {
    const {calls, mockFetch} = makeMockFetch(201, '{"id":1,"name":"Fido"}')
    const {cmd} = makeCall(
      ['petstore', 'createPet', '--body', 'name=Fido', '--header', 'Content-Type=application/vnd.api+json'],
      configDir,
    )
    cmd._fetch = mockFetch
    await cmd.run()
    expect(calls[0].headers['Content-Type']).to.equal('application/vnd.api+json')
  })

  it('errors when a required path parameter is missing', async () => {
    const {cmd} = makeCall(['petstore', 'showPetById'], configDir)
    cmd._fetch = makeMockFetch(200, '{}').mockFetch
    let errorMsg = ''
    cmd.error = (msg: Error | string) => {
      errorMsg = String(msg)
      throw new Error(errorMsg)
    }

    await cmd.run().catch(() => {})
    expect(errorMsg).to.include('petId')
  })
})
