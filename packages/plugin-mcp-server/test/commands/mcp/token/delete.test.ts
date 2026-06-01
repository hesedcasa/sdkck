import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import McpTokenDelete from '../../../../src/commands/mcp/token/delete.js'
import {readMcpAuth, writeMcpAuth} from '../../../../src/mcp-auth.js'

function makeDelete(configDir: string): {cmd: McpTokenDelete; output: () => string} {
  const lines: string[] = []
  const config = {
    bin: 'sdkck',
    configDir,
    runHook: async () => ({failures: [], successes: []}),
  } as never
  const cmd = new McpTokenDelete([], config)
  cmd.log = (message = '') => {
    lines.push(String(message))
  }

  return {cmd, output: () => lines.join('\n')}
}

describe('mcp token delete', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-mcp-del-'))
  })

  afterEach(async () => {
    await rm(tmpDir, {recursive: true})
  })

  it('removes the token file', async () => {
    await writeMcpAuth(tmpDir, 'tok')
    const {cmd} = makeDelete(tmpDir)
    await cmd.run()
    expect(await readMcpAuth(tmpDir)).to.be.null
  })

  it('prints a confirmation message', async () => {
    await writeMcpAuth(tmpDir, 'tok')
    const {cmd, output} = makeDelete(tmpDir)
    await cmd.run()
    expect(output()).to.match(/removed|deleted/i)
  })

  it('succeeds and confirms even when no token was configured', async () => {
    const {cmd} = makeDelete(tmpDir)
    await cmd.run()
  })
})
