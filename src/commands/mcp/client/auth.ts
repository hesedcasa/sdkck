import {Args, Command} from '@oclif/core'
import {action} from '@oclif/core/ux'

import {discoverTools, readServerFile, writeServerFile} from '../../../mcp-client-store.js'
import {deleteOAuthState} from '../../../mcp-oauth.js'

export default class McpClientAuth extends Command {
  static args = {
    name: Args.string({description: 'Name of the MCP server to re-authenticate', required: true}),
  }
  static description = 'Re-authenticate an HTTP MCP server via OAuth browser flow'
  static examples = ['<%= config.bin %> mcp client auth browserstack-remote']
  // Injectable for tests
  _discoverTools: typeof discoverTools = discoverTools

  async run(): Promise<void> {
    const {args} = await this.parse(McpClientAuth)
    const {name} = args

    const serverFile = await readServerFile(this.config.configDir, name)
    if (!serverFile) {
      this.error(`MCP server "${name}" not found. Run 'mcp client list' to see configured servers.`)
    }

    if (serverFile.config.transport !== 'http') {
      this.error(`"${name}" uses stdio transport — OAuth re-authentication only applies to HTTP servers.`)
    }

    await deleteOAuthState(this.config.configDir, name)
    action.start(`Re-authenticating "${name}"`)

    let tools
    try {
      tools = await this._discoverTools(serverFile.config, this.config.configDir)
      action.stop('✓')
    } catch (error) {
      action.stop('✗')
      this.error(`Failed to re-authenticate "${name}": ${(error as Error).message}`)
    }

    await writeServerFile(this.config.configDir, {
      ...serverFile,
      cachedTools: tools,
      cacheTimestamp: Date.now(),
    })

    this.log(`Re-authenticated and refreshed ${tools.length} tool(s) for "${name}".`)
  }
}
