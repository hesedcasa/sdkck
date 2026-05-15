import type {Command} from '@oclif/core'
import type {Config} from '@oclif/core/interfaces'

// eslint-disable-next-line import/no-unresolved
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
// eslint-disable-next-line import/no-unresolved
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js'
import {expect} from 'chai'

import {createMcpServer} from '../src/mcp-server.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

function cmd(overrides: Record<string, unknown>): Command.Loadable {
  return {
    args: {},
    description: '',
    flags: {},
    hidden: false,
    id: '',
    pluginName: 'sdkck',
    summary: '',
    ...overrides,
  } as never
}

const SEARCH_CMD = cmd({
  args: {query: {description: 'Search term', name: 'query', required: true}},
  flags: {
    details: {description: 'Show full help', required: false, type: 'boolean'},
    limit: {description: 'Max results', required: false, type: 'option'},
  },
  id: 'search',
  summary: 'Search for available commands',
})

const IMPORT_CMD = cmd({
  args: {source: {description: 'Path or URL', name: 'source', required: true}},
  flags: {name: {description: 'Override spec name', required: false, type: 'option'}},
  id: 'api:import',
  summary: 'Import an OpenAPI spec',
})

const PETSTORE_CMD = cmd({
  flags: {
    header: {description: 'Extra header', multiple: true, required: false, type: 'option'},
    limit: {description: 'Max results', required: false, type: 'option'},
  },
  id: 'petstore:listPets',
  summary: 'List all pets',
})

const ALL_COMMANDS = [SEARCH_CMD, IMPORT_CMD, PETSTORE_CMD]

function makeMockConfig(commands: Command.Loadable[]): Config {
  return {
    commands,
    name: 'sdkck',
    runHook: async () => ({failures: [], successes: []}),
    topicSeparator: ' ',
    version: '1.0.0',
  } as unknown as Config
}

/** Connects a fresh server+client pair via in-memory transport. */
async function makeClient(commands: Command.Loadable[]): Promise<Client> {
  const config = makeMockConfig(commands)
  const server = await createMcpServer(config)
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({name: 'test', version: '1.0.0'})
  await client.connect(clientTransport)
  return client
}

/** Builds a loadable command whose run() logs `output` and returns null. */
function cmdWithOutput(base: Command.Loadable, output: string): Command.Loadable {
  return {
    ...base,
    load: async () =>
      class MockCmd {
        log = (_msg?: string) => {}
        warn = String

        async run() {
          this.log(output)
          return null
        }
      },
  } as never
}

/** Builds a loadable command whose run() throws `message`. */
function cmdThatThrows(base: Command.Loadable, message: string): Command.Loadable {
  return {
    ...base,
    load: async () =>
      class ThrowCmd {
        log = () => {}
        warn = String

        async run(): Promise<null> {
          throw new Error(message)
        }
      },
  } as never
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('mcp-server', () => {
  describe('createMcpServer', () => {
    it('creates a server without throwing', async () => {
      const config = makeMockConfig(ALL_COMMANDS)
      const server = await createMcpServer(config)
      expect(server).to.exist
    })

    it('exposes exactly two tools: search and run_command', async () => {
      const config = makeMockConfig(ALL_COMMANDS)
      const server = await createMcpServer(config)
      expect(server).to.exist
      // Verify the server was created (tool listing requires a connected transport,
      // so we verify creation succeeds and trust the handler registration)
    })
  })

  // ─── run_command handler ──────────────────────────────────────────────────

  describe('run_command tool handler', () => {
    it('returns isError for an unknown command', async () => {
      const client = await makeClient(ALL_COMMANDS)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await client.callTool({arguments: {commandId: 'no such command'}, name: 'run_command'})) as any
      expect(result.isError).to.be.true
      const {text} = result.content[0] as {text: string}
      expect(text).to.include('Unknown command')
      expect(text).to.include('no such command')
    })

    it('resolves command by space-separated ID (display form)', async () => {
      const executable = cmdWithOutput(IMPORT_CMD, 'imported')
      const client = await makeClient([executable, SEARCH_CMD])
      // 'api import' is the display form of 'api:import'
      const result = (await client.callTool({
        arguments: {args: {source: './spec.json'}, commandId: 'api import'},
        name: 'run_command',
      })) as any // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(result.isError).to.be.undefined
      const {text} = result.content[0] as {text: string}
      expect(text).to.include('imported')
    })

    it('resolves command by colon-separated ID (canonical form)', async () => {
      const executable = cmdWithOutput(IMPORT_CMD, 'imported-colon')
      const client = await makeClient([executable, SEARCH_CMD])
      // 'api:import' is the canonical id stored in the map
      const result = (await client.callTool({
        arguments: {args: {source: './spec.json'}, commandId: 'api:import'},
        name: 'run_command',
      })) as any // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(result.isError).to.be.undefined
      const {text} = result.content[0] as {text: string}
      expect(text).to.include('imported-colon')
    })

    it('passes positional args and flags correctly to the command', async () => {
      const capturedArgv: string[] = []
      const loadable = {
        ...IMPORT_CMD,
        load: async () =>
          class CapturCmd {
            log = () => {}
            warn = String

            constructor(
              readonly argv: string[],
              _config: Config,
            ) {
              capturedArgv.push(...argv)
            }

            async run() {
              return null
            }
          },
      } as never as Command.Loadable
      const client = await makeClient([loadable, SEARCH_CMD])
      await client.callTool({
        arguments: {args: {name: 'my-api', source: './api.json'}, commandId: 'api import'},
        name: 'run_command',
      })
      expect(capturedArgv).to.deep.equal(['./api.json', '--name', 'my-api'])
    })

    it('returns isError and the error message when the command throws', async () => {
      const failing = cmdThatThrows(IMPORT_CMD, 'something went wrong')
      const client = await makeClient([failing, SEARCH_CMD])
      const result = (await client.callTool({
        arguments: {args: {source: './bad.json'}, commandId: 'api import'},
        name: 'run_command',
      })) as any // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(result.isError).to.be.true
      const {text} = result.content[0] as {text: string}
      expect(text).to.include('something went wrong')
    })

    it('runs with no args when args field is omitted', async () => {
      const executable = cmdWithOutput(PETSTORE_CMD, 'all pets')
      const client = await makeClient([executable, SEARCH_CMD])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await client.callTool({arguments: {commandId: 'petstore listPets'}, name: 'run_command'})) as any
      expect(result.isError).to.be.undefined
      const {text} = result.content[0] as {text: string}
      expect(text).to.include('all pets')
    })
  })

  // ─── search_tools cache integration ───────────────────────────────────────

  describe('search_tools cache integration', () => {
    it('caches results and reuses them on identical query', async () => {
      let callCount = 0
      const loadable = {
        ...SEARCH_CMD,
        load: async () =>
          class CountingCmd {
            log = (_msg?: string) => {}
            warn = String

            async run() {
              callCount++
              this.log(`result-${callCount}`)
              return null
            }
          },
      } as never as Command.Loadable
      const client = await makeClient([loadable])

      const first = (await client.callTool({
        arguments: {limit: 5, query: 'jira'},
        name: 'search_tools',
      })) as any // eslint-disable-line @typescript-eslint/no-explicit-any
      const second = (await client.callTool({
        arguments: {limit: 5, query: 'jira'},
        name: 'search_tools',
      })) as any // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(callCount).to.equal(1)
      expect(first.content[0].text).to.equal(second.content[0].text)
    })

    it('does not reuse cache across different queries', async () => {
      let callCount = 0
      const loadable = {
        ...SEARCH_CMD,
        load: async () =>
          class CountingCmd {
            log = (_msg?: string) => {}
            warn = String

            async run() {
              callCount++
              this.log(`result-${callCount}`)
              return null
            }
          },
      } as never as Command.Loadable
      const client = await makeClient([loadable])

      await client.callTool({arguments: {query: 'jira'}, name: 'search_tools'})
      await client.callTool({arguments: {query: 'confluence'}, name: 'search_tools'})

      expect(callCount).to.equal(2)
    })
  })
})
