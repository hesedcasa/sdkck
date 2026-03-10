import {CallToolRequestSchema, ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js'
import {expect} from 'chai'

import McpServe from '../../../src/commands/mcp/serve.js'

type MockCommand = {
  description?: string
  hidden: boolean
  id: string
  pluginName: string
  summary?: string
}

const FIXTURE_COMMANDS: MockCommand[] = [
  {hidden: false, id: 'help', pluginName: '@oclif/plugin-help', summary: 'Display help for sdkck.'},
  {hidden: false, id: 'update', pluginName: '@oclif/plugin-update', summary: 'Update the sdkck CLI.'},
  {hidden: false, id: 'search', pluginName: 'sdkck', summary: 'Search for available commands'},
  {hidden: false, id: 'plugins install', pluginName: '@oclif/plugin-plugins', summary: 'Install a plugin.'},
  {hidden: true, id: 'hidden-cmd', pluginName: 'sdkck', summary: 'Hidden command'},
]

function makeServe(argv: string[] = []): McpServe {
  const config = {
    bin: 'sdkck',
    commands: FIXTURE_COMMANDS,
    root: '/fake/root',
    runHook: async () => ({failures: [], successes: []}),
    topicSeparator: ' ',
    version: '0.4.0',
  } as never
  return new McpServe(argv, config)
}

/**
 * Creates a mock MCP Server keyed by schema object reference,
 * matching the way `server.setRequestHandler` works in the real SDK.
 */
function makeMockServer(): {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>
  listTools(): Promise<unknown>
  server: unknown
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers = new Map<unknown, (req: any) => Promise<unknown>>()

  const server = {
    async connect() {},
    setRequestHandler(schema: unknown, handler: (req: unknown) => Promise<unknown>) {
      handlers.set(schema, handler)
    },
  }

  return {
    async callTool(name: string, args: Record<string, unknown>) {
      const handler = handlers.get(CallToolRequestSchema)
      if (!handler) throw new Error('CallTool handler not registered')
      return handler({params: {arguments: args, name}})
    },
    async listTools() {
      const handler = handlers.get(ListToolsRequestSchema)
      if (!handler) throw new Error('ListTools handler not registered')
      return handler({params: {}})
    },
    server,
  }
}

describe('mcp serve', () => {
  describe('command metadata', () => {
    it('has the correct description', () => {
      expect(McpServe.description).to.equal('Start an MCP server exposing search and execute tools')
    })

    it('has examples', () => {
      expect(McpServe.examples).to.have.length.greaterThan(0)
    })

    it('exposes _server for dependency injection', () => {
      const cmd = makeServe()
      expect(cmd._server).to.equal(null)
    })
  })

  describe('tool registration', () => {
    it('registers exactly search and execute tools', async () => {
      const mock = makeMockServer()
      const cmd = makeServe()
      cmd._server = mock.server as never

      await cmd.run()

      const result = (await mock.listTools()) as {tools: Array<{name: string}>}
      const toolNames = result.tools.map((t) => t.name)
      expect(toolNames).to.include('search')
      expect(toolNames).to.include('execute')
      expect(toolNames).to.have.length(2)
    })

    it('search tool requires a query string', async () => {
      const mock = makeMockServer()
      const cmd = makeServe()
      cmd._server = mock.server as never

      await cmd.run()

      const result = (await mock.listTools()) as {
        tools: Array<{inputSchema: {properties: Record<string, {type: string}>; required?: string[]}; name: string}>
      }
      const searchTool = result.tools.find((t) => t.name === 'search')!
      expect(searchTool.inputSchema.properties).to.have.property('query')
      expect(searchTool.inputSchema.properties.query.type).to.equal('string')
      expect(searchTool.inputSchema.required).to.include('query')
    })

    it('execute tool requires a command string and has optional args array', async () => {
      const mock = makeMockServer()
      const cmd = makeServe()
      cmd._server = mock.server as never

      await cmd.run()

      const result = (await mock.listTools()) as {
        tools: Array<{inputSchema: {properties: Record<string, {type: string}>; required: string[]}; name: string}>
      }
      const executeTool = result.tools.find((t) => t.name === 'execute')!
      expect(executeTool.inputSchema.properties).to.have.property('command')
      expect(executeTool.inputSchema.properties).to.have.property('args')
      expect(executeTool.inputSchema.required).to.include('command')
      expect(executeTool.inputSchema.required).to.not.include('args')
    })
  })

  describe('search tool', () => {
    it('returns matching commands as a JSON array', async () => {
      const mock = makeMockServer()
      const cmd = makeServe()
      cmd._server = mock.server as never

      await cmd.run()

      const result = (await mock.callTool('search', {query: 'help'})) as {
        content: Array<{text: string; type: string}>
      }
      expect(result.content[0].type).to.equal('text')
      const parsed = JSON.parse(result.content[0].text) as Array<{id: string}>
      expect(parsed.some((c) => c.id === 'help')).to.be.true
    })

    it('each result has id, summary, description, and plugin fields', async () => {
      const mock = makeMockServer()
      const cmd = makeServe()
      cmd._server = mock.server as never

      await cmd.run()

      const result = (await mock.callTool('search', {query: 'search'})) as {
        content: Array<{text: string}>
      }
      const parsed = JSON.parse(result.content[0].text) as Array<{
        description: string
        id: string
        plugin: string
        summary: string
      }>
      expect(parsed[0]).to.have.keys('id', 'summary', 'description', 'plugin')
    })

    it('excludes hidden commands', async () => {
      const mock = makeMockServer()
      const cmd = makeServe()
      cmd._server = mock.server as never

      await cmd.run()

      const result = (await mock.callTool('search', {query: 'hidden'})) as {
        content: Array<{text: string}>
      }
      const parsed = JSON.parse(result.content[0].text) as Array<{id: string}>
      expect(parsed.some((c) => c.id === 'hidden-cmd')).to.be.false
    })

    it('excludes @oclif/plugin-plugins commands', async () => {
      const mock = makeMockServer()
      const cmd = makeServe()
      cmd._server = mock.server as never

      await cmd.run()

      const result = (await mock.callTool('search', {query: 'install'})) as {
        content: Array<{text: string}>
      }
      const parsed = JSON.parse(result.content[0].text) as Array<{id: string}>
      expect(parsed.some((c) => c.id === 'plugins install')).to.be.false
    })

    it('returns an empty array when no commands match', async () => {
      const mock = makeMockServer()
      const cmd = makeServe()
      cmd._server = mock.server as never

      await cmd.run()

      const result = (await mock.callTool('search', {query: 'zzzznonexistent'})) as {
        content: Array<{text: string}>
      }
      const parsed = JSON.parse(result.content[0].text) as unknown[]
      expect(parsed).to.deep.equal([])
    })
  })

  describe('execute tool', () => {
    it('throws for unknown tool names', async () => {
      const mock = makeMockServer()
      const cmd = makeServe()
      cmd._server = mock.server as never

      await cmd.run()

      try {
        await mock.callTool('unknown-tool', {})
        expect.fail('should have thrown')
      } catch (error: unknown) {
        expect((error as Error).message).to.include('Unknown tool')
      }
    })
  })
})
