import {expect} from 'chai'
import {readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import Generate, {ApiSpec, LlmClient} from '../../src/commands/generate.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_SPEC: ApiSpec = {
  baseUrl: 'https://api.petstore.example.com',
  description: 'A sample Pet Store API',
  endpoints: [
    {
      description: 'Returns a single pet by its ID',
      method: 'GET',
      operationId: 'getPetById',
      parameters: [{description: 'Pet ID', in: 'path', name: 'id', required: true, type: 'string'}],
      path: '/pets/{id}',
      summary: 'Get a pet by ID',
    },
    {
      description: 'Returns all pets',
      method: 'GET',
      operationId: 'listPets',
      parameters: [
        {description: 'Maximum number of results', in: 'query', name: 'limit', required: false, type: 'integer'},
      ],
      path: '/pets',
      summary: 'List all pets',
    },
    {
      description: 'Creates a new pet',
      method: 'POST',
      operationId: 'createPet',
      parameters: [],
      path: '/pets',
      summary: 'Create a pet',
    },
    {
      description: 'Deletes a pet',
      method: 'DELETE',
      operationId: 'deletePet',
      parameters: [{description: 'Pet ID', in: 'path', name: 'id', required: true, type: 'string'}],
      path: '/pets/{id}',
      summary: 'Delete a pet',
    },
  ],
  name: 'petstore',
}

function makeMockLlmClient(spec: ApiSpec): LlmClient {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [{message: {content: JSON.stringify(spec)}}],
        }),
      },
    },
  }
}

const BASE_CONFIG = {
  bin: 'sdkck',
  commands: [],
  runHook: async () => ({failures: [], successes: []}),
  topicSeparator: ' ',
} as never

function makeGenerate(argv: string[]): {cmd: Generate; logs: () => string} {
  const lines: string[] = []
  const cmd = new Generate(argv, BASE_CONFIG)
  cmd.log = (message = '') => {
    lines.push(String(message))
  }

  return {cmd, logs: () => lines.join('\n')}
}

// ---------------------------------------------------------------------------
// Helpers that don't require a running command
// ---------------------------------------------------------------------------

describe('generate', () => {
  describe('_groupEndpoints', () => {
    it('groups by first non-param path segment', () => {
      const {cmd} = makeGenerate(['https://example.com'])
      const groups = cmd._groupEndpoints(FIXTURE_SPEC.endpoints)
      expect(Object.keys(groups)).to.include('pets')
      expect(groups.pets).to.have.lengthOf(4)
    })

    it('falls back to "root" when every segment is a path param', () => {
      const {cmd} = makeGenerate(['https://example.com'])
      const groups = cmd._groupEndpoints([
        {
          description: '',
          method: 'GET',
          operationId: 'getRoot',
          parameters: [],
          path: '/{id}',
          summary: '',
        },
      ])
      expect(Object.keys(groups)).to.include('root')
    })
  })

  describe('_endpointAction', () => {
    it('uses the operationId slug when it is descriptive', () => {
      const {cmd} = makeGenerate(['https://example.com'])
      expect(
        cmd._endpointAction({
          description: '',
          method: 'GET',
          operationId: 'getPetById',
          parameters: [],
          path: '/pets/{id}',
          summary: '',
        }),
      ).to.equal('get-pet-by-id')
    })

    it('falls back to method map when operationId is just the HTTP verb', () => {
      const {cmd} = makeGenerate(['https://example.com'])
      expect(
        cmd._endpointAction({
          description: '',
          method: 'POST',
          operationId: 'post',
          parameters: [],
          path: '/pets',
          summary: '',
        }),
      ).to.equal('create')
    })

    it('maps GET -> get, POST -> create, PUT -> update, DELETE -> delete, PATCH -> patch', () => {
      const {cmd} = makeGenerate(['https://example.com'])
      const cases: Array<[string, string]> = [
        ['GET', 'get'],
        ['POST', 'create'],
        ['PUT', 'update'],
        ['DELETE', 'delete'],
        ['PATCH', 'patch'],
      ]
      for (const [method, expected] of cases) {
        expect(
          cmd._endpointAction({description: '', method, operationId: '', parameters: [], path: '/x', summary: ''}),
        ).to.equal(expected)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // Full plugin generation (filesystem tests)
  // ---------------------------------------------------------------------------

  describe('_generatePlugin (filesystem)', () => {
    let outDir: string

    before(async () => {
      const {cmd} = makeGenerate(['https://example.com'])
      outDir = join(tmpdir(), `sdkck-generate-test-${Date.now()}`)
      await cmd._generatePlugin('petstore', '@hesed', outDir, FIXTURE_SPEC)
    })

    after(async () => {
      await rm(outDir, {force: true, recursive: true})
    })

    it('creates package.json with the correct package name', async () => {
      const raw = await readFile(join(outDir, 'package.json'), 'utf8')
      const pkg = JSON.parse(raw) as {name: string}
      expect(pkg.name).to.equal('@hesed/petstore')
    })

    it('writes a valid tsconfig.json', async () => {
      const raw = await readFile(join(outDir, 'tsconfig.json'), 'utf8')
      const config = JSON.parse(raw) as {compilerOptions: {strict: boolean}}
      expect(config.compilerOptions.strict).to.equal(true)
    })

    it('creates src/index.ts', async () => {
      const content = await readFile(join(outDir, 'src', 'index.ts'), 'utf8')
      expect(content).to.include('@oclif/core')
    })

    it('creates bin/run.js and bin/dev.js', async () => {
      const run = await readFile(join(outDir, 'bin', 'run.js'), 'utf8')
      const dev = await readFile(join(outDir, 'bin', 'dev.js'), 'utf8')
      expect(run).to.include('@oclif/core')
      expect(dev).to.include('ts-node/esm')
    })

    it('creates a command file for each endpoint', async () => {
      const getPet = await readFile(join(outDir, 'src', 'commands', 'pets', 'get-pet-by-id.ts'), 'utf8')
      expect(getPet).to.include('class PetsGetPetById')
      expect(getPet).to.include("method: \"GET\"")
    })

    it('generates a command that includes the path parameter as an Arg', async () => {
      const content = await readFile(join(outDir, 'src', 'commands', 'pets', 'get-pet-by-id.ts'), 'utf8')
      expect(content).to.include('Args.string')
      expect(content).to.include('args.id')
    })

    it('generates a command that includes query parameters as Flags', async () => {
      const content = await readFile(join(outDir, 'src', 'commands', 'pets', 'list-pets.ts'), 'utf8')
      expect(content).to.include('Flags.string')
      expect(content).to.include('limit')
    })

    it('generates a POST command with a --data flag for the body', async () => {
      const content = await readFile(join(outDir, 'src', 'commands', 'pets', 'create-pet.ts'), 'utf8')
      expect(content).to.include("method: \"POST\"")
      expect(content).to.include('data')
    })

    it('always includes a --base-url flag for runtime URL overriding', async () => {
      const content = await readFile(join(outDir, 'src', 'commands', 'pets', 'get-pet-by-id.ts'), 'utf8')
      expect(content).to.include('base-url')
      expect(content).to.include('https://api.petstore.example.com')
    })

    it('creates a README.md referencing the plugin name', async () => {
      const readme = await readFile(join(outDir, 'README.md'), 'utf8')
      expect(readme).to.include('@hesed/petstore')
      expect(readme).to.include('A sample Pet Store API')
    })
  })

  // ---------------------------------------------------------------------------
  // Full run() integration (mocked fetch + mocked LLM)
  // ---------------------------------------------------------------------------

  describe('run() with mocked dependencies', () => {
    let outDir: string

    afterEach(async () => {
      if (outDir) await rm(outDir, {force: true, recursive: true})
    })

    it('generates a plugin and prints installation instructions', async () => {
      outDir = join(tmpdir(), `sdkck-generate-run-test-${Date.now()}`)
      const {cmd, logs} = makeGenerate([
        'https://api.petstore.example.com/openapi.json',
        '--name',
        'petstore',
        '--out',
        outDir,
      ])

      // Prevent real HTTP and OpenAI calls
      cmd._fetchDoc = async () => 'mock API documentation content'
      cmd._llmClient = makeMockLlmClient(FIXTURE_SPEC)

      await cmd.run()

      expect(logs()).to.include('Plugin generated successfully')
      expect(logs()).to.include('plugins install')
      expect(logs()).to.include('plugins link')
    })

    it('logs a + line for each generated command', async () => {
      outDir = join(tmpdir(), `sdkck-generate-run-test-${Date.now()}`)
      const {cmd, logs} = makeGenerate([
        'https://api.petstore.example.com/openapi.json',
        '--name',
        'petstore',
        '--out',
        outDir,
      ])

      cmd._fetchDoc = async () => 'mock content'
      cmd._llmClient = makeMockLlmClient(FIXTURE_SPEC)

      await cmd.run()

      // One + line per endpoint
      const plusLines = logs()
        .split('\n')
        .filter((l) => l.startsWith('  + '))
      expect(plusLines).to.have.length(FIXTURE_SPEC.endpoints.length)
    })

    it('uses deriveNameFromUrl when --name is omitted and LLM returns no name', async () => {
      outDir = join(tmpdir(), `sdkck-generate-run-test-${Date.now()}`)
      const specNoName: ApiSpec = {...FIXTURE_SPEC, name: ''}
      const {cmd, logs} = makeGenerate(['https://api.example.com/openapi.json', '--out', outDir])

      cmd._fetchDoc = async () => 'mock content'
      cmd._llmClient = makeMockLlmClient(specNoName)

      await cmd.run()

      // The derived name should be 'example' (from api.example.com)
      expect(logs()).to.include('example')
    })

    it('errors when OPENAI_API_KEY is absent and no client is injected', async () => {
      const original = process.env.OPENAI_API_KEY
      delete process.env.OPENAI_API_KEY

      const {cmd} = makeGenerate(['https://example.com/api', '--out', '/tmp/unused'])
      cmd._fetchDoc = async () => 'mock'

      try {
        await cmd.run()
        expect.fail('Should have thrown')
      } catch (error: unknown) {
        expect((error as Error).message).to.include('OPENAI_API_KEY')
      } finally {
        if (original !== undefined) process.env.OPENAI_API_KEY = original
      }
    })
  })
})
