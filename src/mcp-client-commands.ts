import type {Config} from '@oclif/core/interfaces'

import {Command, Flags} from '@oclif/core'
import {encode} from '@toon-format/toon'

import {
  callMcpTool,
  listServerFiles,
  type McpSchemaProperty,
  type McpServerConfig,
  type McpToolSchema,
  readServerFile,
} from './mcp-client-store.js'

// ─── Schema → flag helpers ────────────────────────────────────────────────────

function schemaPropertyToFlag(name: string, prop: McpSchemaProperty, required: boolean): unknown {
  const description = (required ? '(required) ' : '') + (prop.description ?? name)

  if (prop.type === 'boolean') {
    return Flags.boolean({description, required: false})
  }

  // Always optional at the oclif level so --json-args can bypass individual flags
  // without oclif rejecting the parse. Required enforcement is done in buildToolArgsFromFlags.
  return Flags.string({description, required: false})
}

function coercePropertyValue(prop: McpSchemaProperty, value: unknown): unknown {
  if (prop.type === 'object' || prop.type === 'array') {
    try {
      return JSON.parse(value as string)
    } catch {
      return value
    }
  }

  if (prop.type === 'integer' || prop.type === 'number') {
    const n = Number(value)
    return Number.isNaN(n) ? value : n
  }

  return value
}

interface ToolArgContext {
  positionalNames: string[]
  properties: Record<string, McpSchemaProperty>
  requiredSet: Set<string>
}

function buildToolArgsFromFlags(
  ctx: ToolArgContext,
  parsedArgs: Record<string, string>,
  parsedFlags: Record<string, unknown>,
): Record<string, unknown> {
  const {positionalNames, properties, requiredSet} = ctx
  const toolArgs: Record<string, unknown> = {}

  for (const name of positionalNames) {
    const value = parsedArgs[name]
    if (value !== undefined) toolArgs[name] = value
  }

  for (const [name, prop] of Object.entries(properties)) {
    if (positionalNames.includes(name)) continue
    const value = parsedFlags[name]
    if (value !== undefined) toolArgs[name] = coercePropertyValue(prop, value)
  }

  for (const required of requiredSet) {
    if (!positionalNames.includes(required) && toolArgs[required] === undefined) {
      throw new Error(`Missing required argument: --${required}`)
    }
  }

  return toolArgs
}

// ─── Dynamic command factory ──────────────────────────────────────────────────

function createMcpToolCommand(serverName: string, tool: McpToolSchema): typeof Command {
  const properties = tool.inputSchema.properties ?? {}
  const requiredSet = new Set(tool.inputSchema.required ?? [])

  // All properties become flags (no positional args).
  // Positional args break command ID resolution when commands are registered dynamically
  // via init hooks, because normalizeArgv runs before init hooks fire and cannot tell
  // where the command ID ends and positional args begin.
  const positionalNames: string[] = []
  const dynamicFlags: Record<string, unknown> = {}

  for (const [name, prop] of Object.entries(properties)) {
    dynamicFlags[name] = schemaPropertyToFlag(name, prop, requiredSet.has(name))
  }

  dynamicFlags['json-args'] = Flags.string({
    description: 'Tool arguments as a JSON object (overrides individual flags)',
    required: false,
  })

  dynamicFlags.toon = Flags.boolean({
    description: 'Encode JSON output with TOON for token-efficient LLM consumption',
    required: false,
  })

  const commandId = `${serverName}:${tool.name}`
  const toolDescription = tool.description ?? tool.name

  const capturedServerName = serverName
  const capturedToolName = tool.name
  const capturedPositionalNames = positionalNames
  const capturedProperties = properties
  const capturedRequiredSet = requiredSet

  class DynamicMcpToolCommand extends Command {
    static description = toolDescription
    // Cast required: dynamicFlags is built at runtime
    static flags = dynamicFlags as typeof Command.flags
    static id = commandId
    // Exposed for testing — inject a mock to avoid encoding in unit tests
    _applyToon: (value: unknown) => string = encode
    // Exposed for testing — inject a mock to avoid real MCP connections
    // ts-prune-ignore-next
    _callTool: typeof callMcpTool = callMcpTool

    async run(): Promise<void> {
      const {flags: f} = await this.parse(DynamicMcpToolCommand as unknown as typeof Command)

      const serverFile = await readServerFile(this.config.configDir, capturedServerName)
      if (!serverFile) {
        this.error(`MCP server "${capturedServerName}" not found. Run 'mcp client list' to see configured servers.`)
      }

      const serverConfig: McpServerConfig = serverFile.config
      const jsonArgsFlag = (f as Record<string, unknown>)['json-args']

      let toolArgs: Record<string, unknown>
      if (jsonArgsFlag === undefined) {
        try {
          toolArgs = buildToolArgsFromFlags(
            {
              positionalNames: capturedPositionalNames,
              properties: capturedProperties,
              requiredSet: capturedRequiredSet,
            },
            {},
            f as Record<string, unknown>,
          )
        } catch (error) {
          this.error((error as Error).message)
        }
      } else {
        try {
          toolArgs = JSON.parse(jsonArgsFlag as string) as Record<string, unknown>
        } catch {
          this.error('--json-args must be a valid JSON object')
        }
      }

      const useToon = Boolean((f as Record<string, unknown>).toon)
      const formatText = (text: string): string => {
        if (!useToon) return text
        try {
          return this._applyToon(JSON.parse(text))
        } catch {
          return text
        }
      }

      try {
        const result = await this._callTool(serverConfig, capturedToolName, toolArgs, this.config.configDir)

        if (result.isError) {
          const errorText = result.content
            .filter((c) => c.type === 'text')
            .map((c) => c.text ?? '')
            .join('\n')
          this.error(errorText || 'Tool call failed')
        }

        for (const item of result.content) {
          if (item.type === 'text') {
            this.log(formatText(item.text ?? ''))
          } else if (item.type === 'image') {
            this.log(`[image/${item.mimeType ?? 'unknown'}: base64 data omitted]`)
          } else {
            this.log(useToon ? this._applyToon(item) : JSON.stringify(item, null, 2))
          }
        }
      } catch (error) {
        this.error(`Failed to call tool "${capturedToolName}": ${(error as Error).message}`)
      }
    }
  }

  return DynamicMcpToolCommand
}

// ─── Registration ─────────────────────────────────────────────────────────────

interface LoadableCommand {
  aliases: string[]
  args: Record<string, unknown>
  description?: string
  flags: Record<string, unknown>
  hidden: boolean
  id: string
  load(): Promise<typeof Command>
  pluginName?: string
  pluginType?: string
  strict: boolean
}

interface InternalConfig {
  _commands: Map<string, LoadableCommand>
  _topics: Map<string, {description?: string; hidden: boolean; name: string}>
}

/**
 * Reads the mcp-client store and injects one oclif command per cached tool into
 * the Config's internal `_commands` map, making them visible in `help`, `commands`,
 * and invocable directly as `<serverName> <toolName> [args] [flags]`.
 */
export async function registerMcpClientCommands(config: Config): Promise<void> {
  const serverFiles = await listServerFiles(config.configDir)
  const internal = config as unknown as InternalConfig

  for (const serverFile of serverFiles) {
    const {cachedTools, config: serverConfig} = serverFile
    if (!cachedTools || cachedTools.length === 0) continue

    const serverName = serverConfig.name

    if (!internal._topics.has(serverName)) {
      internal._topics.set(serverName, {
        description: `MCP tools from ${serverName}`,
        hidden: false,
        name: serverName,
      })
    }

    for (const tool of cachedTools) {
      const commandId = `${serverName}:${tool.name}`
      if (internal._commands.has(commandId)) continue

      const CmdClass = createMcpToolCommand(serverName, tool)

      internal._commands.set(commandId, {
        aliases: [],
        args: {},
        description: tool.description ?? tool.name,
        flags: CmdClass.flags as Record<string, unknown>,
        hidden: false,
        id: commandId,
        async load() {
          return CmdClass
        },
        pluginName: config.name,
        pluginType: 'core',
        strict: true,
      })
    }
  }
}
