import {Args, Command} from '@oclif/core'
import {action} from '@oclif/core/ux'

import {discoverTools, listServerFiles, readServerFile, writeServerFile} from '../../../mcp-client-store.js'

export default class McpClientRefresh extends Command {
  static args = {
    name: Args.string({description: 'Name of the MCP server to refresh (refreshes all if omitted)', required: false}),
  }
  static description = 'Refresh the cached tool list for one or all MCP servers'
  static examples = ['<%= config.bin %> mcp client refresh', '<%= config.bin %> mcp client refresh github']

  async run(): Promise<void> {
    const {args} = await this.parse(McpClientRefresh)

    await (args.name ? this.refreshOne(args.name) : this.refreshAll())
  }

  private async refreshAll(): Promise<void> {
    const serverFiles = await listServerFiles(this.config.configDir)

    if (serverFiles.length === 0) {
      this.log("No MCP servers configured. Run 'mcp client add' to add one.")
      return
    }

    await Promise.all(serverFiles.map((sf) => this.refreshOne(sf.config.name)))
  }

  private async refreshOne(name: string): Promise<void> {
    const serverFile = await readServerFile(this.config.configDir, name)
    if (!serverFile) {
      this.error(`MCP server "${name}" not found. Run 'mcp client list' to see configured servers.`)
    }

    action.start(`Refreshing tools for "${name}"`)

    let tools
    try {
      tools = await discoverTools(serverFile.config, this.config.configDir)
      action.stop('✓')
    } catch (error) {
      action.stop('✗')
      this.warn(`Failed to refresh "${name}": ${(error as Error).message}`)
      return
    }

    await writeServerFile(this.config.configDir, {
      ...serverFile,
      cachedTools: tools,
      cacheTimestamp: Date.now(),
    })

    this.log(`  ${tools.length} tool(s) cached for "${name}"`)
  }
}
