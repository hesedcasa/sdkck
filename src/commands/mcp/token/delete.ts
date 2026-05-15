import {Command} from '@oclif/core'

import {deleteMcpAuth} from '../../../mcp-auth.js'

export default class McpTokenDelete extends Command {
  static description = 'Remove the MCP server Bearer token, disabling HTTP authentication'
  static examples = ['<%= config.bin %> mcp token delete']

  async run(): Promise<void> {
    await this.parse(McpTokenDelete)
    await deleteMcpAuth(this.config.configDir)
    this.log('MCP token removed. HTTP authentication disabled.')
  }
}
