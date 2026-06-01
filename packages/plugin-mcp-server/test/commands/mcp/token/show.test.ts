import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import McpTokenShow from '../../../../src/commands/mcp/token/show.js'
import {writeMcpAuth} from '../../../../src/mcp-auth.js'

function makeShow(configDir: string): {cmd: McpTokenShow; output: () => string} {
  const lines: string[] = []
  const config = {
    bin: 'sdkck',
    configDir,
    runHook: async () => ({failures: [], successes: []}),
  } as never
  const cmd = new McpTokenShow([], config)
  cmd.log = (message = '') => {
    lines.push(String(message))
  }

  return {cmd, output: () => lines.join('\n')}
}

describe('mcp token show', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-mcp-show-'))
  })

  afterEach(async () => {
    await rm(tmpDir, {recursive: true})
  })

  it('prints the stored token', async () => {
    await writeMcpAuth(tmpDir, 'deadbeef')
    const {cmd, output} = makeShow(tmpDir)
    await cmd.run()
    expect(output()).to.include('deadbeef')
  })

  it('throws when no token is configured', async () => {
    const {cmd} = makeShow(tmpDir)
    try {
      await cmd.run()
      expect.fail('Expected an error to be thrown')
    } catch (error) {
      expect((error as Error).message).to.include('No MCP token configured')
    }
  })
})
