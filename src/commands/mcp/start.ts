import {Command} from '@oclif/core'

import {startMcpServer} from '../../mcp-server.js'

export default class McpStart extends Command {
  static description = 'Start an MCP server over stdio, exposing all CLI commands as tools'
  static examples = ['<%= config.bin %> mcp start']

  async run(): Promise<void> {
    await this.parse(McpStart)
    await startMcpServer(this.config)
  }
}
