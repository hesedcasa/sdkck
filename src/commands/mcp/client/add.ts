import {Args, Command, Flags} from '@oclif/core'
import {action} from '@oclif/core/ux'

import {discoverTools, type McpServerConfig, writeServerFile} from '../../../mcp-client-store.js'

export default class McpClientAdd extends Command {
  static args = {
    name: Args.string({description: 'Name for the MCP server', required: true}),
  }
  static description = 'Add an MCP server and register its tools as native CLI commands'
  static examples = [
    '<%= config.bin %> mcp client add github --command npx --args @modelcontextprotocol/server-github',
    '<%= config.bin %> mcp client add myserver --command ./bin/server.js --args start --env API_KEY=abc123',
    '<%= config.bin %> mcp client add remote --url http://localhost:3000/mcp',
    '<%= config.bin %> mcp client add remote --url https://api.example.com/mcp --header Authorization="Bearer token"',
  ]
  static flags = {
    args: Flags.string({
      description: 'Argument to pass to the server command (repeatable)',
      multiple: true,
      required: false,
    }),
    command: Flags.string({
      char: 'c',
      description: 'Command to run the MCP server (stdio transport)',
      required: false,
    }),
    env: Flags.string({
      description: 'Environment variable for the server process as KEY=VALUE (repeatable)',
      multiple: true,
      required: false,
    }),
    header: Flags.string({
      description: 'HTTP header for the MCP server as Key=Value (repeatable)',
      multiple: true,
      required: false,
    }),
    url: Flags.string({
      char: 'u',
      description: 'URL of the MCP server (http transport)',
      required: false,
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(McpClientAdd)
    const {name} = args

    if (!flags.command && !flags.url) {
      this.error('Either --command (stdio) or --url (http) is required')
    }

    if (flags.command && flags.url) {
      this.error('Specify only one of --command (stdio) or --url (http)')
    }

    const transport: 'http' | 'stdio' = flags.url ? 'http' : 'stdio'

    // Parse env vars
    const env: Record<string, string> = {}
    for (const pair of flags.env ?? []) {
      const idx = pair.indexOf('=')
      if (idx === -1) {
        env[pair] = ''
      } else {
        env[pair.slice(0, idx)] = pair.slice(idx + 1)
      }
    }

    // Parse headers
    const headers: Record<string, string> = {}
    for (const pair of flags.header ?? []) {
      const idx = pair.indexOf('=')
      if (idx === -1) {
        headers[pair] = ''
      } else {
        headers[pair.slice(0, idx)] = pair.slice(idx + 1)
      }
    }

    const serverConfig: McpServerConfig = {
      name,
      transport,
      ...(transport === 'stdio'
        ? {
            args: flags.args ?? [],
            command: flags.command!,
            ...(Object.keys(env).length > 0 && {env}),
          }
        : {
            ...(Object.keys(headers).length > 0 && {headers}),
            url: flags.url!,
          }),
    }

    action.start(`Connecting to MCP server "${name}"`)

    let tools
    try {
      tools = await discoverTools(serverConfig, this.config.configDir)
      action.stop('✓')
    } catch (error) {
      action.stop('✗')
      this.error(`Failed to connect to MCP server: ${(error as Error).message}`)
    }

    await writeServerFile(this.config.configDir, {
      cachedTools: tools,
      cacheTimestamp: Date.now(),
      config: serverConfig,
    })

    this.log(`Added MCP server "${name}" with ${tools.length} tool(s):`)
    for (const tool of tools) {
      this.log(`  ${name} ${tool.name}${tool.description ? ` — ${tool.description}` : ''}`)
    }

    if (tools.length > 0) {
      this.log(`\nRun '${this.config.bin} ${name} <tool> --help' to see tool usage.`)
    }
  }
}
