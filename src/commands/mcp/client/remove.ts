import {Args, Command} from '@oclif/core'

import {deleteServerFile, readServerFile} from '../../../mcp-client-store.js'
import {deleteOAuthState} from '../../../mcp-oauth.js'

export default class McpClientRemove extends Command {
  static args = {
    name: Args.string({description: 'Name of the MCP server to remove', required: true}),
  }
  static description = 'Remove a configured MCP server and its cached tools'
  static examples = ['<%= config.bin %> mcp client remove github']

  async run(): Promise<void> {
    const {args} = await this.parse(McpClientRemove)
    const {name} = args

    const existing = await readServerFile(this.config.configDir, name)
    if (!existing) {
      this.error(`MCP server "${name}" not found. Run 'mcp client list' to see configured servers.`)
    }

    await deleteServerFile(this.config.configDir, name)
    await deleteOAuthState(this.config.configDir, name)
    this.log(`Removed MCP server "${name}".`)
  }
}
