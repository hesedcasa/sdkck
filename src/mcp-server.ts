import type {Config} from '@oclif/core/interfaces'

// eslint-disable-next-line import/no-unresolved
import {Server} from '@modelcontextprotocol/sdk/server/index.js'
// eslint-disable-next-line import/no-unresolved
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
// eslint-disable-next-line import/no-unresolved
import {CallToolRequestSchema, ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js'
import {Command, toConfiguredId} from '@oclif/core'

// ─── Argv builder ────────────────────────────────────────────────────────────

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

export function createSamplingAdapter(server: Server): SamplingClient {
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

          const result = await server.createMessage({
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

export async function createMcpServer(config: Config): Promise<Server> {
  const server = new Server({name: 'sdkck', version: config.version ?? '0.0.0'}, {capabilities: {tools: {}}})

  // Build command lookup for run_command
  const commandById = new Map(config.commands.map((c) => [c.id, c]))
  // Also index by display name (space-separated) for convenience
  for (const c of config.commands) {
    const displayId = toConfiguredId(c.id, config)
    if (displayId !== c.id) commandById.set(displayId, c)
  }

  const searchCmd = config.commands.find((c) => c.id === 'search')

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        description:
          'Search for available sdkck CLI commands. ' +
          'Returns command names and descriptions ranked by relevance. ' +
          'Use this to discover commands before running them.',
        inputSchema: {
          properties: {
            limit: {description: 'Maximum number of results (default 5)', type: 'number'},
            query: {description: 'Search query describing the task or command you are looking for', type: 'string'},
          },
          required: ['query'],
          type: 'object',
        },
        name: 'search',
      },
      {
        description:
          'Run a sdkck CLI command. Use the "search" tool first to discover ' +
          'available commands and their arguments. Pass the command ID and any ' +
          'required arguments.',
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
              description: 'The command ID to run (e.g. "openapi import", "permission list")',
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

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const {arguments: toolArgs, name} = request.params

    if (name === 'search') {
      if (!searchCmd) {
        return {content: [{text: 'Search command not available', type: 'text' as const}], isError: true}
      }

      const query = (toolArgs?.query as string) ?? ''
      const limit = toolArgs?.limit as number | undefined
      const argv = [query]
      if (limit !== undefined) argv.push('--limit', String(limit))

      const samplingClient = createSamplingAdapter(server)
      const {error, output} = await runCommand(searchCmd, argv, config, samplingClient)
      if (error) {
        return {content: [{text: error, type: 'text' as const}], isError: true}
      }

      return {content: [{text: output, type: 'text' as const}]}
    }

    if (name === 'run_command') {
      const commandId = (toolArgs?.commandId as string) ?? ''
      // Try exact match, then try colon-separated form (space→colon)
      const cmd = commandById.get(commandId) ?? commandById.get(commandId.replaceAll(' ', ':'))
      if (!cmd) {
        return {
          content: [{text: `Unknown command: "${commandId}". Use the "search" tool to find available commands.`, type: 'text' as const}],
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

  return server
}

export async function startMcpServer(config: Config): Promise<void> {
  const server = await createMcpServer(config)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
