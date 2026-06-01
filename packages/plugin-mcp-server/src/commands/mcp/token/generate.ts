import {Command} from '@oclif/core'
import {randomBytes} from 'node:crypto'

import {writeMcpAuth} from '../../../mcp-auth.js'

export default class McpTokenGenerate extends Command {
  static description = 'Generate a Bearer token for MCP server HTTP authentication'
  static examples = ['<%= config.bin %> mcp token generate']

  async run(): Promise<void> {
    await this.parse(McpTokenGenerate)
    const token = randomBytes(32).toString('hex')
    await writeMcpAuth(this.config.configDir, token)
    this.log(token)
  }
}
