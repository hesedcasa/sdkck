import {expect} from 'chai'

import McpStart from '../../../src/commands/mcp/start.js'

describe('mcp start', () => {
  it('has the expected description', () => {
    expect(McpStart.description).to.include('MCP')
  })

  it('can be instantiated', () => {
    const config = {
      bin: 'sdkck',
      commands: [],
      runHook: async () => ({failures: [], successes: []}),
    } as never
    const cmd = new McpStart([], config)
    expect(cmd).to.be.instanceOf(McpStart)
  })
})
