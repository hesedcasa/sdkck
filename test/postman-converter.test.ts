import {expect} from 'chai'

import {isPostmanCollection, type PostmanCollection, postmanToOpenApi} from '../src/postman-converter.js'

function extractOperationIds(paths: Record<string, Record<string, unknown>>): string[] {
  return Object.values(paths).flatMap((methods) =>
    Object.values(methods as Record<string, {operationId: string}>).map((op) => op.operationId),
  )
}

const PETSTORE_POSTMAN: PostmanCollection = {
  info: {
    '_postman_id': 'abc-123',
    description: 'A sample Petstore API',
    name: 'Petstore',
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
          query: [{description: 'Max items', key: 'limit', value: '10'}],
          raw: 'https://petstore.example.com/pets?limit=10',
        },
      },
    },
    {
      name: 'Create Pet',
      request: {
        body: {
          mode: 'raw',
          raw: '{"name": "Fido", "tag": "dog"}',
        },
        description: 'Create a new pet',
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
        description: 'Get a pet by ID',
        method: 'GET',
        url: {
          host: ['petstore', 'example', 'com'],
          path: ['pets', ':petId'],
          raw: 'https://petstore.example.com/pets/:petId',
          variable: [{description: 'Pet ID', key: 'petId', value: '1'}],
        },
      },
    },
  ],
}

describe('postman-converter', () => {
  describe('isPostmanCollection', () => {
    it('returns true for a collection with schema.getpostman.com in info.schema', () => {
      expect(isPostmanCollection({info: {schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'}})).to.be.true
    })

    it('returns true for a collection with info._postman_id', () => {
      expect(isPostmanCollection({info: {'_postman_id': 'abc-123'}})).to.be.true
    })

    it('returns false for an OpenAPI spec', () => {
      expect(isPostmanCollection({info: {title: 'API', version: '1.0'}, openapi: '3.0.0'})).to.be.false
    })

    it('returns false for null/undefined/non-object', () => {
      expect(isPostmanCollection(null)).to.be.false
      expect(isPostmanCollection()).to.be.false
      expect(isPostmanCollection('string')).to.be.false
    })

    it('returns false for an object without info', () => {
      expect(isPostmanCollection({item: []})).to.be.false
    })
  })

  describe('postmanToOpenApi', () => {
    it('converts a Postman collection to OpenAPI 3.0 format', () => {
      const spec = postmanToOpenApi(PETSTORE_POSTMAN)
      expect(spec.openapi).to.equal('3.0.0')
      expect(spec.info.title).to.equal('Petstore')
      expect(spec.info.description).to.equal('A sample Petstore API')
    })

    it('extracts base URL from the first request', () => {
      const spec = postmanToOpenApi(PETSTORE_POSTMAN)
      expect(spec.servers).to.have.length(1)
      expect(spec.servers![0].url).to.equal('https://petstore.example.com')
    })

    it('creates paths for each request', () => {
      const spec = postmanToOpenApi(PETSTORE_POSTMAN)
      expect(spec.paths).to.have.property('/pets')
      expect(spec.paths).to.have.property('/pets/{petId}')
    })

    it('maps HTTP methods correctly', () => {
      const spec = postmanToOpenApi(PETSTORE_POSTMAN)
      expect(spec.paths['/pets']).to.have.property('get')
      expect(spec.paths['/pets']).to.have.property('post')
      expect(spec.paths['/pets/{petId}']).to.have.property('get')
    })

    it('generates operationIds from request names', () => {
      const spec = postmanToOpenApi(PETSTORE_POSTMAN)
      const getOp = spec.paths['/pets'].get as {operationId: string}
      expect(getOp.operationId).to.equal('list-pets')
      const postOp = spec.paths['/pets'].post as {operationId: string}
      expect(postOp.operationId).to.equal('create-pet')
    })

    it('extracts query parameters', () => {
      const spec = postmanToOpenApi(PETSTORE_POSTMAN)
      const getOp = spec.paths['/pets'].get as {parameters: Array<{in: string; name: string}>}
      expect(getOp.parameters).to.have.length(1)
      expect(getOp.parameters[0].name).to.equal('limit')
      expect(getOp.parameters[0].in).to.equal('query')
    })

    it('extracts path variables', () => {
      const spec = postmanToOpenApi(PETSTORE_POSTMAN)
      const getOp = spec.paths['/pets/{petId}'].get as {parameters: Array<{in: string; name: string; required: boolean}>}
      expect(getOp.parameters).to.have.length(1)
      expect(getOp.parameters[0].name).to.equal('petId')
      expect(getOp.parameters[0].in).to.equal('path')
      expect(getOp.parameters[0].required).to.be.true
    })

    it('extracts request body from raw JSON', () => {
      const spec = postmanToOpenApi(PETSTORE_POSTMAN)
      const postOp = spec.paths['/pets'].post as {requestBody: {content: {'application/json': {schema: {properties: Record<string, unknown>}}}}}
      expect(postOp.requestBody).to.exist
      expect(postOp.requestBody.content['application/json'].schema.properties).to.have.property('name')
      expect(postOp.requestBody.content['application/json'].schema.properties).to.have.property('tag')
    })

    it('handles nested folders by prefixing operationId', () => {
      const collection: PostmanCollection = {
        info: {
          name: 'Nested API',
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: [
          {
            item: [
              {
                name: 'List Users',
                request: {method: 'GET', url: {host: ['api', 'example', 'com'], path: ['users']}},
              },
            ],
            name: 'Users',
          },
        ],
      }
      const spec = postmanToOpenApi(collection)
      const getOp = spec.paths['/users'].get as {operationId: string}
      expect(getOp.operationId).to.equal('users-list-users')
    })

    it('ensures unique operationIds for duplicate names', () => {
      const collection: PostmanCollection = {
        info: {
          name: 'Dupe API',
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: [
          {
            name: 'Get Data',
            request: {method: 'GET', url: {host: ['api', 'example', 'com'], path: ['data']}},
          },
          {
            name: 'Get Data',
            request: {method: 'GET', url: {host: ['api', 'example', 'com'], path: ['data2']}},
          },
        ],
      }
      const spec = postmanToOpenApi(collection)
      const ids = extractOperationIds(spec.paths)
      const unique = new Set(ids)
      expect(unique.size).to.equal(ids.length)
    })

    it('handles an empty collection', () => {
      const collection: PostmanCollection = {
        info: {
          name: 'Empty',
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: [],
      }
      const spec = postmanToOpenApi(collection)
      expect(spec.paths).to.deep.equal({})
    })

    it('handles string URLs', () => {
      const collection: PostmanCollection = {
        info: {
          name: 'String URL API',
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: [
          {
            name: 'Get Root',
            request: {method: 'GET', url: 'https://api.example.com/health'},
          },
        ],
      }
      const spec = postmanToOpenApi(collection)
      expect(spec.paths).to.have.property('/health')
    })
  })
})
