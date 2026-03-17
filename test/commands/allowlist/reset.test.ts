import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {readAllowlistConfig, writeAllowlistConfig} from '../../../src/allowlist-config.js'
import AllowlistReset from '../../../src/commands/allowlist/reset.js'

function makeReset(argv: string[], configDir: string): {cmd: AllowlistReset; output: () => string} {
  const lines: string[] = []
  const config = {
    bin: 'sdkck',
    configDir,
    runHook: async () => ({failures: [], successes: []}),
  } as never
  const cmd = new AllowlistReset(argv, config)
  cmd.log = (message = '') => {
    lines.push(String(message))
  }

  return {cmd, output: () => lines.join('\n')}
}

describe('allowlist reset', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, {recursive: true})
  })

  it('clears all rules when --confirm is passed', async () => {
    await writeAllowlistConfig(tmpDir, {
      rules: [
        {action: 'allow', pattern: 'jira'},
        {action: 'disallow', pattern: 'mysql'},
      ],
    })

    const {cmd, output} = makeReset(['--confirm'], tmpDir)
    await cmd.run()

    expect(output()).to.contain('All allowlist rules have been removed.')
    const saved = await readAllowlistConfig(tmpDir)
    expect(saved.rules).to.deep.equal([])
  })

  it('cancels when the prompt response is not "yes"', async () => {
    await writeAllowlistConfig(tmpDir, {rules: [{action: 'allow', pattern: 'jira'}]})

    const {cmd, output} = makeReset([], tmpDir)
    // Override prompt to return a non-confirming answer
    cmd._prompt = async () => 'no'
    await cmd.run()

    expect(output()).to.contain('Reset cancelled.')
    const saved = await readAllowlistConfig(tmpDir)
    expect(saved.rules).to.have.length(1)
  })

  it('proceeds when the prompt response is "yes"', async () => {
    await writeAllowlistConfig(tmpDir, {rules: [{action: 'allow', pattern: 'jira'}]})

    const {cmd, output} = makeReset([], tmpDir)
    cmd._prompt = async () => 'yes'
    await cmd.run()

    expect(output()).to.contain('All allowlist rules have been removed.')
    const saved = await readAllowlistConfig(tmpDir)
    expect(saved.rules).to.deep.equal([])
  })
})
