import {expect} from 'chai'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {
  type ApiStore,
  buildAuthHeaders,
  buildUrl,
  deleteSpec,
  extractBaseUrl,
  extractOperations,
  parseKV,
  readStore,
  writeStore,
} from '../src/api-store.js'

describe('api-store', () => {
  // ─── readStore / writeStore / deleteSpec ──────────────────────────────────────

  describe('readStore', () => {
    let tmpDir: string

    before(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-test-'))
    })

    after(async () => {
      await rm(tmpDir, {recursive: true})
    })

    it('returns an empty store for a non-existent configDir', async () => {
      const store = await readStore(join(tmpDir, 'does-not-exist'))
      expect(store.specs).to.deep.equal({})
    })

    it('returns an empty store for a configDir with no spec files', async () => {
      const dir = join(tmpDir, 'empty')
      await mkdir(dir)
      await writeFile(join(dir, 'other.json'), '{}')
      const store = await readStore(dir)
      expect(store.specs).to.deep.equal({})
    })

    it('reads and parses spec files matching the openapi-<name>.json pattern', async () => {
      const dir = join(tmpDir, 'with-specs')
      const spec = {
        auth: {type: 'none'},
        baseUrl: 'https://example.com',
        description: '',
        name: 'myapi',
        operations: [],
        source: './myapi.json',
        title: 'My API',
      }
      await mkdir(dir)
      await writeFile(join(dir, 'openapi-myapi.json'), JSON.stringify(spec))
      const store = await readStore(dir)
      expect(store.specs).to.have.property('myapi')
      expect(store.specs.myapi.title).to.equal('My API')
    })

    it('ignores files that do not match the openapi-<name>.json pattern', async () => {
      const dir = join(tmpDir, 'mixed-files')
      const spec = {
        auth: {type: 'none'},
        baseUrl: '',
        description: '',
        name: 'real',
        operations: [],
        source: '',
        title: 'Real',
      }
      await mkdir(dir)
      await writeFile(join(dir, 'openapi-real.json'), JSON.stringify(spec))
      await writeFile(join(dir, 'other-real.json'), JSON.stringify(spec))
      await writeFile(join(dir, 'openapi-real.yaml'), JSON.stringify(spec))
      const store = await readStore(dir)
      expect(Object.keys(store.specs)).to.have.length(1)
      expect(store.specs).to.have.property('real')
    })

    it('skips files with invalid JSON', async () => {
      const dir = join(tmpDir, 'invalid-json')
      await mkdir(dir)
      await writeFile(join(dir, 'openapi-broken.json'), 'not json')
      const store = await readStore(dir)
      expect(store.specs).to.deep.equal({})
    })

    it('reads multiple spec files into the same store', async () => {
      const dir = join(tmpDir, 'multi-specs')
      await mkdir(dir)
      await Promise.all(
        ['alpha', 'beta', 'gamma'].map((name) => {
          const spec = {
            auth: {type: 'none'},
            baseUrl: '',
            description: '',
            name,
            operations: [],
            source: '',
            title: name,
          }
          return writeFile(join(dir, `openapi-${name}.json`), JSON.stringify(spec))
        }),
      )

      const store = await readStore(dir)
      expect(Object.keys(store.specs)).to.have.length(3)
      expect(store.specs).to.have.property('alpha')
      expect(store.specs).to.have.property('beta')
      expect(store.specs).to.have.property('gamma')
    })
  })

  describe('writeStore', () => {
    let tmpDir: string

    before(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-test-'))
    })

    after(async () => {
      await rm(tmpDir, {recursive: true})
    })

    it('creates the configDir if it does not exist', async () => {
      const dir = join(tmpDir, 'new-config')
      const store: ApiStore = {specs: {}}
      await writeStore(dir, store)
      const readBack = await readStore(dir)
      expect(readBack.specs).to.deep.equal({})
    })

    it('writes one JSON file per spec using the openapi-<name>.json naming', async () => {
      const dir = join(tmpDir, 'write-test')
      const store: ApiStore = {
        specs: {
          bar: {
            auth: {type: 'none'},
            baseUrl: 'https://bar.com',
            description: '',
            name: 'bar',
            operations: [],
            source: '',
            title: 'Bar',
          },
          foo: {
            auth: {type: 'none'},
            baseUrl: 'https://foo.com',
            description: '',
            name: 'foo',
            operations: [],
            source: '',
            title: 'Foo',
          },
        },
      }
      await writeStore(dir, store)
      const readBack = await readStore(dir)
      expect(Object.keys(readBack.specs)).to.have.length(2)
      expect(readBack.specs.foo.title).to.equal('Foo')
      expect(readBack.specs.bar.baseUrl).to.equal('https://bar.com')
    })

    it('round-trips a store with operations and auth', async () => {
      const dir = join(tmpDir, 'roundtrip')
      const store: ApiStore = {
        specs: {
          api: {
            auth: {scheme: 'bearer', token: 'tok', type: 'http'},
            baseUrl: 'https://api.example.com',
            description: 'An API',
            name: 'api',
            operations: [
              {
                bodyParams: {title: {required: true, type: 'string'}},
                description: 'Create item',
                method: 'post',
                operationId: 'createItem',
                parameters: [{in: 'query', name: 'dry-run', required: false, schema: {type: 'boolean'}}],
                path: '/items',
              },
            ],
            source: './api.json',
            title: 'The API',
          },
        },
      }
      await writeStore(dir, store)
      const readBack = await readStore(dir)
      expect(readBack.specs.api.auth).to.deep.equal(store.specs.api.auth)
      expect(readBack.specs.api.operations[0].operationId).to.equal('createItem')
      expect(readBack.specs.api.operations[0].bodyParams.title.required).to.be.true
    })
  })

  describe('deleteSpec', () => {
    let tmpDir: string

    before(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-test-'))
    })

    after(async () => {
      await rm(tmpDir, {recursive: true})
    })

    it('returns true and removes the spec file', async () => {
      const dir = join(tmpDir, 'delete-test')
      const store: ApiStore = {
        specs: {
          todelete: {
            auth: {type: 'none'},
            baseUrl: '',
            description: '',
            name: 'todelete',
            operations: [],
            source: '',
            title: 'Del',
          },
        },
      }
      await writeStore(dir, store)
      const result = await deleteSpec(dir, 'todelete')
      expect(result).to.be.true
      const readBack = await readStore(dir)
      expect(readBack.specs).not.to.have.property('todelete')
    })

    it('returns false when the spec file does not exist', async () => {
      const result = await deleteSpec(join(tmpDir, 'nonexistent-dir'), 'ghost')
      expect(result).to.be.false
    })
  })

  // ─── extractOperations ────────────────────────────────────────────────────────

  describe('extractOperations', () => {
    it('extracts basic operations from an OpenAPI 3.x spec', () => {
      const ops = extractOperations({
        paths: {
          '/pets': {
            get: {description: 'List pets', operationId: 'listPets', parameters: [], summary: 'List pets'},
            post: {description: 'Create pet', operationId: 'createPet', summary: 'Create pet'},
          },
        },
      })
      expect(ops).to.have.length(2)
      const ids = ops.map((o) => o.operationId)
      expect(ids).to.include('listPets')
      expect(ids).to.include('createPet')
    })

    it('derives operationId from method and path when missing', () => {
      const ops = extractOperations({
        paths: {'/users/{id}': {get: {summary: 'Get user'}}},
      })
      expect(ops[0].operationId).to.equal('get-users-id')
    })

    it('normalises operationId by replacing non-word characters with dashes and collapsing runs', () => {
      const ops = extractOperations({
        paths: {'/foo': {get: {operationId: 'list--Foo!!Bar', summary: 'x'}}},
      })
      // underscores are word chars (\w) so they are preserved; other special chars become -
      expect(ops[0].operationId).to.equal('list-Foo-Bar')
    })

    it('passes through inline parameters', () => {
      const ops = extractOperations({
        paths: {
          '/items': {
            get: {
              operationId: 'listItems',
              parameters: [{description: 'Page limit', in: 'query', name: 'limit', required: false}],
            },
          },
        },
      })
      expect(ops[0].parameters).to.have.length(1)
      expect(ops[0].parameters[0].name).to.equal('limit')
      expect(ops[0].parameters[0].in).to.equal('query')
    })

    it('extracts body params from application/json request body schema', () => {
      const ops = extractOperations({
        paths: {
          '/pets': {
            post: {
              operationId: 'createPet',
              requestBody: {
                content: {
                  'application/json': {
                    schema: {
                      properties: {
                        name: {type: 'string'},
                        tag: {description: 'Optional tag', type: 'string'},
                      },
                      required: ['name'],
                      type: 'object',
                    },
                  },
                },
              },
            },
          },
        },
      })
      const op = ops[0]
      expect(op.bodyParams).to.have.property('name')
      expect(op.bodyParams.name.required).to.be.true
      expect(op.bodyParams).to.have.property('tag')
      expect(op.bodyParams.tag.required).to.be.false
      expect(op.bodyParams.tag.description).to.equal('Optional tag')
    })

    it('extracts body params from an inline request body schema', () => {
      const ops = extractOperations({
        paths: {
          '/pets': {
            post: {
              operationId: 'createPet',
              requestBody: {
                content: {
                  'application/json': {
                    schema: {
                      properties: {name: {type: 'string'}},
                      required: ['name'],
                      type: 'object',
                    },
                  },
                },
              },
            },
          },
        },
      })
      expect(ops[0].bodyParams.name.required).to.be.true
    })

    it('stores summary as the operation description', () => {
      const ops = extractOperations({
        paths: {'/x': {get: {operationId: 'getX', summary: 'Get X'}}},
      })
      expect(ops[0].description).to.equal('Get X')
    })

    it('falls back to raw description when summary is absent', () => {
      const ops = extractOperations({
        paths: {'/x': {get: {description: 'Get X raw', operationId: 'getX'}}},
      })
      expect(ops[0].description).to.equal('Get X raw')
    })

    it('returns an empty array for a spec with no paths', () => {
      expect(extractOperations({})).to.deep.equal([])
      expect(extractOperations({paths: {}})).to.deep.equal([])
    })

    it('preserves the http method on each operation', () => {
      const ops = extractOperations({
        paths: {
          '/r': {
            delete: {operationId: 'delR'},
            get: {operationId: 'getR'},
            patch: {operationId: 'patchR'},
            post: {operationId: 'postR'},
            put: {operationId: 'putR'},
          },
        },
      })
      const methods = ops.map((o) => o.method)
      expect(methods).to.include.members(['get', 'post', 'put', 'patch', 'delete'])
    })
  })

  // ─── extractBaseUrl ───────────────────────────────────────────────────────────

  describe('extractBaseUrl', () => {
    it('extracts from OpenAPI 3.x servers array', () => {
      expect(extractBaseUrl({servers: [{url: 'https://api.example.com/v1'}]})).to.equal('https://api.example.com/v1')
    })

    it('strips trailing slash from server URL', () => {
      expect(extractBaseUrl({servers: [{url: 'https://api.example.com/'}]})).to.equal('https://api.example.com')
    })

    it('uses the first server when multiple are listed', () => {
      expect(
        extractBaseUrl({servers: [{url: 'https://primary.example.com'}, {url: 'https://fallback.example.com'}]}),
      ).to.equal('https://primary.example.com')
    })

    it('extracts from Swagger 2.x host + basePath', () => {
      expect(extractBaseUrl({basePath: '/v2', host: 'api.example.com', schemes: ['https']} as never)).to.equal(
        'https://api.example.com/v2',
      )
    })

    it('defaults to https scheme for Swagger 2.x when schemes is absent', () => {
      expect(extractBaseUrl({host: 'api.example.com'} as never)).to.equal('https://api.example.com')
    })

    it('returns an empty string when no server info is present', () => {
      expect(extractBaseUrl({})).to.equal('')
    })
  })

  // ─── parseKV ──────────────────────────────────────────────────────────────────

  describe('parseKV', () => {
    it('parses a simple key=value pair', () => {
      expect(parseKV(['foo=bar'])).to.deep.equal({foo: 'bar'})
    })

    it('parses multiple pairs', () => {
      expect(parseKV(['a=1', 'b=2'])).to.deep.equal({a: '1', b: '2'})
    })

    it('keeps everything after the first = as the value', () => {
      expect(parseKV(['url=http://x.com/path?q=1'])).to.deep.equal({url: 'http://x.com/path?q=1'})
    })

    it('returns an empty string value when there is no =', () => {
      expect(parseKV(['flag'])).to.deep.equal({flag: ''})
    })

    it('returns an empty object for an empty array', () => {
      expect(parseKV([])).to.deep.equal({})
    })
  })

  // ─── buildAuthHeaders ─────────────────────────────────────────────────────────

  describe('buildAuthHeaders', () => {
    it('returns an empty object for auth type none', () => {
      expect(buildAuthHeaders({type: 'none'})).to.deep.equal({})
    })

    it('returns Authorization: Bearer <token> for http bearer auth', () => {
      expect(buildAuthHeaders({scheme: 'bearer', token: 'abc123', type: 'http'})).to.deep.equal({
        Authorization: 'Bearer abc123',
      })
    })

    it('returns the custom header for apikey auth', () => {
      expect(buildAuthHeaders({apiKey: 'my-key', header: 'X-Api-Key', type: 'apikey'})).to.deep.equal({
        'X-Api-Key': 'my-key',
      })
    })

    it('returns Authorization: Basic <base64> for basic auth', () => {
      const headers = buildAuthHeaders({password: 'pass', type: 'basic', username: 'user'})
      const expected = Buffer.from('user:pass').toString('base64')
      expect(headers).to.deep.equal({Authorization: `Basic ${expected}`})
    })
  })

  // ─── buildUrl ─────────────────────────────────────────────────────────────────

  describe('buildUrl', () => {
    it('returns baseUrl + path when there are no path params', () => {
      expect(buildUrl('https://api.example.com', '/pets', {})).to.equal('https://api.example.com/pets')
    })

    it('interpolates path parameters', () => {
      expect(buildUrl('https://api.example.com', '/pets/{petId}', {petId: '42'})).to.equal(
        'https://api.example.com/pets/42',
      )
    })

    it('URL-encodes path parameter values', () => {
      expect(buildUrl('https://api.example.com', '/items/{name}', {name: 'hello world'})).to.equal(
        'https://api.example.com/items/hello%20world',
      )
    })

    it('replaces multiple path parameters in one call', () => {
      expect(buildUrl('https://api.example.com', '/orgs/{org}/repos/{repo}', {org: 'acme', repo: 'sdk'})).to.equal(
        'https://api.example.com/orgs/acme/repos/sdk',
      )
    })
  })
}) // end api-store
