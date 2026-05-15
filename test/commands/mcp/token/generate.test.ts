import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import McpTokenGenerate from '../../../../src/commands/mcp/token/generate.js'
import {readMcpAuth} from '../../../../src/mcp-auth.js'

function makeGenerate(configDir: string): {cmd: McpTokenGenerate; output: () => string} {
  const lines: string[] = []
  const config = {
    bin: 'sdkck',
    configDir,
    runHook: async () => ({failures: [], successes: []}),
  } as never
  const cmd = new McpTokenGenerate([], config)
  cmd.log = (message = '') => {
    lines.push(String(message))
  }

  return {cmd, output: () => lines.join('\n')}
}

describe('mcp token generate', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-mcp-gen-'))
  })

  afterEach(async () => {
    await rm(tmpDir, {recursive: true})
  })

  it('writes a token to mcp-auth.json', async () => {
    const {cmd} = makeGenerate(tmpDir)
    await cmd.run()
    const stored = await readMcpAuth(tmpDir)
    expect(stored).to.be.a('string').with.lengthOf(64)
    expect(stored).to.match(/^[0-9a-f]{64}$/)
  })

  it('prints the token once', async () => {
    const {cmd, output} = makeGenerate(tmpDir)
    await cmd.run()
    const stored = await readMcpAuth(tmpDir)
    expect(output()).to.include(stored!)
  })

  it('overwrites an existing token', async () => {
    const {cmd: first} = makeGenerate(tmpDir)
    await first.run()
    const token1 = await readMcpAuth(tmpDir)

    const {cmd: second} = makeGenerate(tmpDir)
    await second.run()
    const token2 = await readMcpAuth(tmpDir)

    expect(token2).to.not.equal(token1)
  })
})
