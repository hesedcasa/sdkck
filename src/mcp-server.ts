import type {Config} from '@oclif/core/interfaces'

// eslint-disable-next-line import/no-unresolved
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
// eslint-disable-next-line import/no-unresolved
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
// eslint-disable-next-line import/no-unresolved
import {CallToolRequestSchema, ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js'
import {Command, toConfiguredId} from '@oclif/core'

import {SearchCache} from './search-cache.js'

// ─── Argv builder ────────────────────────────────────────────────────────────

// ts-prune-ignore-next
export function buildArgv(cmd: Command.Loadable, toolArgs: Record<string, unknown>): string[] {
  const argv: string[] = []

  // Positional args in definition order
  for (const name of Object.keys(cmd.args ?? {})) {
    const value = toolArgs[name]
    if (value !== undefined && value !== null) {
      argv.push(String(value))
    }
  }

  // Named flags
  for (const [name, flag] of Object.entries(cmd.flags ?? {})) {
    if (name === 'json') continue
    const value = toolArgs[name]
    if (value === undefined || value === null) continue

    const f = flag as {type: string}
    if (f.type === 'boolean') {
      if (value === true) argv.push(`--${name}`)
    } else if (Array.isArray(value)) {
      for (const v of value) {
        argv.push(`--${name}`, String(v))
      }
    } else {
      argv.push(`--${name}`, String(value))
    }
  }

  return argv
}

// ─── MCP sampling adapter ────────────────────────────────────────────────────

/**
 * Structural interface matching the SamplingClient shape used by the search
 * command. Wraps MCP sampling (server.createMessage) so the connected client's
 * LLM performs command ranking instead of a hard-coded OpenAI call.
 */
interface SamplingClient {
  chat: {
    completions: {
      create(params: {
        max_tokens?: number
        messages: Array<{content: string; role: string}>
        model: string
      }): Promise<{choices: Array<{message: {content: null | string}}>}>
    }
  }
}

function createSamplingAdapter(server: McpServer): SamplingClient {
  return {
    chat: {
      completions: {
        async create(params) {
          let systemPrompt: string | undefined
          const mcpMessages: Array<{content: {text: string; type: 'text'}; role: 'assistant' | 'user'}> = []

          for (const msg of params.messages) {
            if (msg.role === 'system') {
              systemPrompt = msg.content
            } else {
              mcpMessages.push({
                content: {text: msg.content, type: 'text'},
                role: msg.role as 'assistant' | 'user',
              })
            }
          }

          const result = await server.server.createMessage({
            maxTokens: params.max_tokens ?? 1024,
            messages: mcpMessages,
            ...(systemPrompt ? {systemPrompt} : {}),
          })

          const text = result.content.type === 'text' ? result.content.text : ''
          return {choices: [{message: {content: text}}]}
        },
      },
    },
  }
}

// ─── Command execution helper ────────────────────────────────────────────────

async function runCommand(
  cmd: Command.Loadable,
  argv: string[],
  config: Config,
  samplingClient?: SamplingClient,
): Promise<{error?: string; output: string}> {
  try {
    const CmdClass = await cmd.load()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instance = new (CmdClass as any)(argv, config) as Command & {_llmClient?: SamplingClient}

    const lines: string[] = []
    instance.log = (msg = '') => {
      lines.push(String(msg))
    }

    // logJson writes to process.stdout by default; capture it the same way
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(instance as any).logJson = (json: unknown) => {
      lines.push(JSON.stringify(json, null, 2))
    }

    instance.warn = (msg: Error | string) => {
      lines.push(`Warning: ${String(msg)}`)
      return String(msg)
    }

    if (samplingClient) {
      instance._llmClient = samplingClient
    }

    const result = await instance.run()
    const output = result === null || result === undefined ? lines.join('\n') : JSON.stringify(result, null, 2)
    return {output: output || '(no output)'}
  } catch (error) {
    return {error: error instanceof Error ? error.message : String(error), output: ''}
  }
}

// ─── Server factory ──────────────────────────────────────────────────────────

// ts-prune-ignore-next
export async function createMcpServer(config: Config): Promise<McpServer> {
  const mcpServer = new McpServer({name: 'sdkck', version: config.version ?? '0.0.0'}, {capabilities: {tools: {}}})

  // Build command lookup for run_command
  const commandById = new Map(config.commands.map((c) => [c.id, c]))
  // Also index by display name (space-separated) for convenience
  for (const c of config.commands) {
    const displayId = toConfiguredId(c.id, config)
    if (displayId !== c.id) commandById.set(displayId, c)
  }

  const searchCmd = config.commands.find((c) => c.id === 'search')

  const cacheFilePath = config.configDir ? `${config.configDir}/search-cache-mcp.json` : undefined
  const searchCache = new SearchCache({cacheFilePath})

  // Build a deduplicated keyword list from each command's ID parts (topics,
  // subcommands) and its summary/description so the search_tools tool
  // advertises both the namespace and what each command actually does.
  const stopwords = new Set([
    'a',
    'all',
    'an',
    'and',
    'any',
    'are',
    'as',
    'at',
    'be',
    'belong',
    'bin',
    'by',
    'can',
    'current',
    'different',
    'display',
    'displays',
    'for',
    'from',
    'get',
    'has',
    'have',
    'hello',
    'in',
    'into',
    'is',
    'it',
    'its',
    'level',
    'new',
    'of',
    'on',
    'or',
    'over',
    'performed',
    'performs',
    'run',
    'set',
    'show',
    'specific',
    'that',
    'the',
    'their',
    'this',
    'to',
    'use',
    'used',
    'useful',
    'uses',
    'using',
    'will',
    'with',
    'work',
    'you',
  ])

  const keywords = new Set<string>()

  const addWord = (raw: string) => {
    const word = raw.toLowerCase().replaceAll(/^-+|-+$/g, '')
    if (word.length >= 2 && !stopwords.has(word)) keywords.add(word)
  }

  for (const c of config.commands) {
    for (const part of c.id.split(':')) addWord(part)
    const text = `${c.summary ?? ''} ${c.description ?? ''}`
    for (const raw of text.split(/[^a-zA-Z0-9-]+/)) addWord(raw)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jitPlugins = (config.pjson?.oclif as any)?.jitPlugins as Record<string, string> | undefined
  for (const name of Object.keys(jitPlugins ?? {})) {
    const short = name.split('/').pop()
    if (short) addWord(short)
  }

  const searchToolsDescription = `Search for MCP tools with keywords: ${[...keywords].sort().join(' ')}`

  mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        description: searchToolsDescription,
        inputSchema: {
          properties: {
            limit: {description: 'Maximum number of results (default 5)', type: 'number'},
            query: {description: 'Search query describing the task or command you are looking for', type: 'string'},
          },
          required: ['query'],
          type: 'object',
        },
        name: 'search_tools',
      },
      {
        description: 'Run a Sidekick command. Use "search_tools" first to discover commands and their arguments.',
        inputSchema: {
          properties: {
            args: {
              description:
                'Command arguments as key-value pairs. ' +
                'Positional args use their parameter name as the key. ' +
                'Flags use their flag name (without --).',
              type: 'object',
            },
            commandId: {
              description: 'The command ID to run (e.g. "api import", "permission list")',
              type: 'string',
            },
          },
          required: ['commandId'],
          type: 'object',
        },
        name: 'run_command',
      },
    ],
  }))

  mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const {arguments: toolArgs, name} = request.params

    if (name === 'search_tools') {
      if (!searchCmd) {
        return {content: [{text: 'Search command not available', type: 'text' as const}], isError: true}
      }

      const query = (toolArgs?.query as string) ?? ''
      const limit = toolArgs?.limit as number | undefined

      const cached = searchCache.get(query, limit)
      if (cached !== undefined) {
        return {content: [{text: cached, type: 'text' as const}]}
      }

      const argv = [query]
      if (limit !== undefined) argv.push('--limit', String(limit))

      const samplingClient = createSamplingAdapter(mcpServer)
      const {error, output} = await runCommand(searchCmd, argv, config, samplingClient)
      if (error) {
        return {content: [{text: error, type: 'text' as const}], isError: true}
      }

      searchCache.set(query, limit, output)
      return {content: [{text: output, type: 'text' as const}]}
    }

    if (name === 'run_command') {
      const commandId = (toolArgs?.commandId as string) ?? ''
      // Try exact match, then try colon-separated form (space→colon)
      const cmd = commandById.get(commandId) ?? commandById.get(commandId.replaceAll(' ', ':'))
      if (!cmd) {
        return {
          content: [
            {
              text: `Unknown command: "${commandId}". Use the "search" tool to find available commands.`,
              type: 'text' as const,
            },
          ],
          isError: true,
        }
      }

      const cmdArgs = (toolArgs?.args as Record<string, unknown>) ?? {}
      const argv = buildArgv(cmd, cmdArgs)
      const {error, output} = await runCommand(cmd, argv, config)
      if (error) {
        return {content: [{text: error, type: 'text' as const}], isError: true}
      }

      return {content: [{text: output, type: 'text' as const}]}
    }

    return {content: [{text: `Unknown tool: ${name}`, type: 'text' as const}], isError: true}
  })

  return mcpServer
}

export async function startMcpServer(config: Config): Promise<void> {
  const server = await createMcpServer(config)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
