import {Command, Flags} from '@oclif/core'

import {startMcpServer} from '../../mcp-server.js'

export default class McpStart extends Command {
  static description = 'Start an MCP server exposing all CLI commands as tools'
  static examples = [
    '<%= config.bin %> mcp start',
    '<%= config.bin %> mcp start --transport http',
    '<%= config.bin %> mcp start --transport http --port 3001',
    '<%= config.bin %> mcp start --transport http --host 0.0.0.0',
  ]
  static flags = {
    host: Flags.string({
      default: '127.0.0.1',
      description: 'IP address to listen on (HTTP transport only)',
    }),
    port: Flags.integer({
      default: 3000,
      description: 'Port to listen on (HTTP transport only)',
    }),
    transport: Flags.string({
      default: 'stdio',
      description: 'Transport to use',
      options: ['stdio', 'http'],
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(McpStart)
    await startMcpServer(this.config, {host: flags.host, port: flags.port, transport: flags.transport})
  }
}
