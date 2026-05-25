import {Command, Flags} from '@oclif/core'

import {isToolCacheStale, listServerFiles} from '../../../mcp-client-store.js'

export default class McpClientList extends Command {
  static description = 'List configured MCP servers and their cached tools'
  static examples = ['<%= config.bin %> mcp client list', '<%= config.bin %> mcp client list --tools']
  static flags = {
    tools: Flags.boolean({
      char: 't',
      description: 'Show individual tools for each server',
      required: false,
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(McpClientList)
    const serverFiles = await listServerFiles(this.config.configDir)

    if (serverFiles.length === 0) {
      this.log("No MCP servers configured. Run 'mcp client add' to add one.")
      return
    }

    for (const serverFile of serverFiles) {
      const {cachedTools, cacheTimestamp, config} = serverFile
      const stale = isToolCacheStale(serverFile)
      const toolCount = cachedTools?.length ?? 0
      const cachedAt = cacheTimestamp ? new Date(cacheTimestamp).toLocaleString() : 'never'

      const transportDesc =
        config.transport === 'stdio'
          ? `${config.command}${config.args && config.args.length > 0 ? ' ' + config.args.join(' ') : ''}`
          : config.url

      this.log(`${config.name}`)
      this.log(`  Transport: ${config.transport} (${transportDesc})`)
      this.log(`  Tools: ${toolCount}${stale ? " (cache stale — run 'mcp client refresh')" : ''}`)
      this.log(`  Cached at: ${cachedAt}`)

      if (flags.tools && cachedTools && cachedTools.length > 0) {
        for (const tool of cachedTools) {
          this.log(`    ${config.name} ${tool.name}${tool.description ? ` — ${tool.description}` : ''}`)
        }
      }

      this.log('')
    }
  }
}
