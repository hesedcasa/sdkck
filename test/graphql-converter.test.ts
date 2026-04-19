import {expect} from 'chai'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {
  convertSchema,
  hasGraphQLExtension,
  isIntrospectionPayload,
  loadGraphQLSchema,
  parseSchemaSource,
} from '../src/graphql-converter.js'

const SDL = `
"""
A pet in the store.
"""
type Pet {
  id: ID!
  name: String!
  tag: String
  owner: Owner
}

type Owner {
  id: ID!
  name: String!
}

input PetInput {
  name: String!
  tag: String
}

type Query {
  pet(id: ID!): Pet
  pets(limit: Int, tag: String): [Pet!]!
}

type Mutation {
  createPet(input: PetInput!): Pet!
  deletePet(id: ID!): Boolean!
}
`

describe('graphql-converter', () => {
  describe('hasGraphQLExtension', () => {
    it('matches .graphql / .gql / .graphqls', () => {
      expect(hasGraphQLExtension('schema.graphql')).to.be.true
      expect(hasGraphQLExtension('schema.gql')).to.be.true
      expect(hasGraphQLExtension('schema.GRAPHQL')).to.be.true
      expect(hasGraphQLExtension('schema.graphqls')).to.be.true
    })

    it('does not match non-graphql extensions', () => {
      expect(hasGraphQLExtension('schema.json')).to.be.false
      expect(hasGraphQLExtension('openapi.yaml')).to.be.false
      expect(hasGraphQLExtension('https://api.example.com/graphql')).to.be.false
    })
  })

  describe('isIntrospectionPayload', () => {
    it('accepts a bare __schema object', () => {
      expect(isIntrospectionPayload({__schema: {types: []}})).to.be.true
    })

    it('accepts a wrapped {data: {__schema}}', () => {
      expect(isIntrospectionPayload({data: {__schema: {types: []}}})).to.be.true
    })

    it('rejects unrelated JSON', () => {
      expect(isIntrospectionPayload({openapi: '3.0.0'})).to.be.false
      expect(isIntrospectionPayload(null)).to.be.false
      expect(isIntrospectionPayload('string')).to.be.false
    })
  })

  describe('convertSchema', () => {
    const schema = parseSchemaSource(SDL)
    const {operations, title} = convertSchema(schema, {title: 'PetAPI'})

    it('extracts one operation per Query and Mutation field', () => {
      const ids = operations.map((o) => o.operationId).sort()
      expect(ids).to.include('pet')
      expect(ids).to.include('pets')
      expect(ids).to.include('createPet')
      expect(ids).to.include('deletePet')
      expect(operations).to.have.length(4)
    })

    it('preserves the title', () => {
      expect(title).to.equal('PetAPI')
    })

    it('marks method as post and path as empty string for all GraphQL ops', () => {
      for (const op of operations) {
        expect(op.method).to.equal('post')
        expect(op.path).to.equal('')
      }
    })

    it('tags operations with graphql metadata including query document', () => {
      const pet = operations.find((o) => o.operationId === 'pet')!
      expect(pet.graphql).to.exist
      expect(pet.graphql!.operationType).to.equal('query')
      expect(pet.graphql!.fieldName).to.equal('pet')
      expect(pet.graphql!.query).to.include('query queryPet($id: ID!)')
      expect(pet.graphql!.query).to.include('pet(id: $id)')
    })

    it('distinguishes mutation operations in graphql.operationType', () => {
      const createPet = operations.find((o) => o.operationId === 'createPet')!
      expect(createPet.graphql!.operationType).to.equal('mutation')
      expect(createPet.graphql!.query).to.include('mutation mutationCreatePet($input: PetInput!)')
    })

    it('maps argument types: scalar → primitive, input object → object', () => {
      const createPet = operations.find((o) => o.operationId === 'createPet')!
      expect(createPet.bodyParams.input.type).to.equal('object')
      expect(createPet.bodyParams.input.required).to.be.true

      const pets = operations.find((o) => o.operationId === 'pets')!
      expect(pets.bodyParams.limit.type).to.equal('number')
      expect(pets.bodyParams.limit.required).to.be.false
      expect(pets.bodyParams.tag.type).to.equal('string')
    })

    it('generates a selection set including scalar fields', () => {
      const pet = operations.find((o) => o.operationId === 'pet')!
      const {query} = pet.graphql!
      expect(query).to.include('id')
      expect(query).to.include('name')
      expect(query).to.include('tag')
    })

    it('recurses into object-typed fields up to depth', () => {
      const pet = operations.find((o) => o.operationId === 'pet')!
      const {query} = pet.graphql!
      // Owner is an object field on Pet; its scalars should be inlined.
      expect(query).to.include('owner')
      expect(query).to.match(/owner\s*\{[^}]*name/)
    })

    it('emits a Boolean scalar return with no selection set', () => {
      const deletePet = operations.find((o) => o.operationId === 'deletePet')!
      // deletePet returns Boolean! — no brace body following the field
      expect(deletePet.graphql!.query).to.match(/deletePet\(id: \$id\)\s*\n\}/)
    })

    it('prefixes colliding query/mutation fields with -mutation suffix', () => {
      const schemaWithCollision = parseSchemaSource(`
        type Query { foo: String }
        type Mutation { foo: String }
      `)
      const {operations: collisionOps} = convertSchema(schemaWithCollision)
      const ids = collisionOps.map((o) => o.operationId).sort()
      expect(ids).to.include('foo')
      expect(ids).to.include('foo-mutation')
    })

    it('honors selectionDepth to cap recursion', () => {
      const deep = parseSchemaSource(`
        type A { name: String b: B }
        type B { name: String c: C }
        type C { name: String }
        type Query { a: A }
      `)
      const shallow = convertSchema(deep, {selectionDepth: 1}).operations.find((o) => o.operationId === 'a')!
      // Depth 1: A's scalar fields are selected; B is an object beyond the limit and omitted entirely.
      expect(shallow.graphql!.query).to.include('name')
      expect(shallow.graphql!.query).not.to.include('b')
      expect(shallow.graphql!.query).not.to.include('__typename')
    })
  })

  describe('loadGraphQLSchema', () => {
    let tmpDir: string

    before(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-gql-'))
    })

    after(async () => {
      await rm(tmpDir, {recursive: true})
    })

    it('loads an SDL file', async () => {
      const sdlPath = join(tmpDir, 'schema.graphql')
      await writeFile(sdlPath, SDL, 'utf8')
      const schema = await loadGraphQLSchema(sdlPath)
      expect(schema.getQueryType()?.name).to.equal('Query')
      expect(schema.getMutationType()?.name).to.equal('Mutation')
    })

    it('loads an introspection JSON file (wrapped in data)', async () => {
      // Create a minimal introspection result via a round-trip
      const {buildSchema, getIntrospectionQuery, graphqlSync} = await import('graphql')
      const realSchema = buildSchema(SDL)
      const introResult = graphqlSync({schema: realSchema, source: getIntrospectionQuery()})
      const jsonPath = join(tmpDir, 'schema.json')
      await writeFile(jsonPath, JSON.stringify(introResult), 'utf8')

      const schema = await loadGraphQLSchema(jsonPath)
      expect(schema.getQueryType()?.name).to.equal('Query')
    })
  })
})
