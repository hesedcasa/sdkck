import {Command} from '@oclif/core'

import {readMcpAuth} from '../../../mcp-auth.js'

export default class McpTokenShow extends Command {
  static description = 'Show the current MCP server Bearer token'
  static examples = ['<%= config.bin %> mcp token show']

  async run(): Promise<void> {
    await this.parse(McpTokenShow)
    const token = await readMcpAuth(this.config.configDir)
    if (!token) {
      this.error('No MCP token configured. Run "mcp token generate" first.')
    }

    this.log(token)
  }
}
