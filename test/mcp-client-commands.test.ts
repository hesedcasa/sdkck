import type {Config} from '@oclif/core/interfaces'

import {Command} from '@oclif/core'
import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {registerMcpClientCommands} from '../src/mcp-client-commands.js'
import {type McpServerConfig, type McpToolSchema, writeServerFile} from '../src/mcp-client-store.js'

// ─── Types ───────────────────────────────────────────────────────────────────

type McpToolResult = {
  content: Array<{data?: string; mimeType?: string; text?: string; type: string}>
  isError?: boolean
}

type DynamicMcpCmd = Command & {
  _applyToon: (value: unknown) => string
  _callTool: (
    config: McpServerConfig,
    toolName: string,
    args: Record<string, unknown>,
    configDir: string,
  ) => Promise<McpToolResult>
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const FIXTURE_SERVER_CONFIG: McpServerConfig = {
  name: 'test-server',
  transport: 'http',
  url: 'http://localhost:9999/mcp',
}

const FIXTURE_TOOLS: McpToolSchema[] = [
  {
    description: 'Get a pet by ID',
    inputSchema: {
      properties: {petId: {description: 'Pet ID', type: 'string'}},
      required: ['petId'],
      type: 'object',
    },
    name: 'getPet',
  },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

type InternalConfig = {
  _commands: Map<string, {flags: Record<string, unknown>; id: string; load: () => Promise<typeof Command>}>
  _topics: Map<string, unknown>
  configDir: string
  name: string
}

function makeInternalConfig(configDir: string): InternalConfig {
  return {_commands: new Map(), _topics: new Map(), configDir, name: 'sdkck'}
}

async function makeCmd(
  argv: string[],
  configDir: string,
): Promise<{cmd: DynamicMcpCmd; output: () => string; warnings: () => string[]}> {
  const ic = makeInternalConfig(configDir)
  await registerMcpClientCommands(ic as unknown as Config)
  const entry = ic._commands.get('test-server:getPet')
  if (!entry) throw new Error('Command "test-server:getPet" not registered')
  const CmdClass = await entry.load()
  const cmdConfig = {bin: 'sdkck', configDir, runHook: async () => ({failures: [], successes: []})} as never

  const lines: string[] = []
  const warnLines: string[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cmd = new (CmdClass as any)(argv, cmdConfig) as DynamicMcpCmd
  cmd.log = (message = '') => {
    lines.push(String(message))
  }

  cmd.warn = (message: Error | string) => {
    warnLines.push(String(message))
    return message as string
  }

  return {cmd, output: () => lines.join('\n'), warnings: () => warnLines}
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('mcp-client-commands', () => {
  describe('DynamicMcpToolCommand', () => {
    let tmpDir: string
    let configDir: string

    before(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-mcp-test-'))
      configDir = join(tmpDir, 'config')
      await writeServerFile(configDir, {
        cachedTools: FIXTURE_TOOLS,
        config: FIXTURE_SERVER_CONFIG,
      })
    })

    after(async () => {
      await rm(tmpDir, {recursive: true})
    })

    it('registers a command per cached tool', async () => {
      const ic = makeInternalConfig(configDir)
      await registerMcpClientCommands(ic as unknown as Config)
      expect(ic._commands.has('test-server:getPet')).to.be.true
    })

    it('prints text content as-is without --toon', async () => {
      const {cmd, output} = await makeCmd(['--petId', 'abc'], configDir)
      cmd._callTool = async () => ({content: [{text: 'hello world', type: 'text'}]})
      await cmd.run()
      expect(output()).to.equal('hello world')
    })

    it('passes JSON text content through _applyToon when --toon is set', async () => {
      const jsonText = JSON.stringify({id: 1, name: 'Fido'})
      const {cmd, output} = await makeCmd(['--petId', 'abc', '--toon'], configDir)
      cmd._callTool = async () => ({content: [{text: jsonText, type: 'text'}]})
      cmd._applyToon = (value) => `TOON:${JSON.stringify(value)}`
      await cmd.run()
      expect(output()).to.include('TOON:')
      expect(output()).to.include('"name"')
    })

    it('prints non-JSON text content as-is even when --toon is set', async () => {
      const {cmd, output} = await makeCmd(['--petId', 'abc', '--toon'], configDir)
      cmd._callTool = async () => ({content: [{text: 'plain text', type: 'text'}]})
      cmd._applyToon = (value) => `TOON:${JSON.stringify(value)}`
      await cmd.run()
      expect(output()).to.equal('plain text')
      expect(output()).not.to.include('TOON:')
    })

    it('encodes unknown content items with _applyToon when --toon is set', async () => {
      const item = {mimeType: 'application/json', payload: {x: 1}, type: 'resource'}
      const {cmd, output} = await makeCmd(['--petId', 'abc', '--toon'], configDir)
      cmd._callTool = async () => ({content: [item]})
      cmd._applyToon = (value) => `TOON:${JSON.stringify(value)}`
      await cmd.run()
      expect(output()).to.include('TOON:')
    })

    it('pretty-prints unknown content items without --toon', async () => {
      const item = {mimeType: 'application/json', payload: {x: 1}, type: 'resource'}
      const {cmd, output} = await makeCmd(['--petId', 'abc'], configDir)
      cmd._callTool = async () => ({content: [item]})
      await cmd.run()
      expect(output()).to.include('"mimeType"')
    })
  })
})
