import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {readAllowlistConfig, writeAllowlistConfig} from '../../../src/allowlist-config.js'
import AllowlistDisallow from '../../../src/commands/allowlist/disallow.js'

function makeDisallow(argv: string[], configDir: string): {cmd: AllowlistDisallow; output: () => string} {
  const lines: string[] = []
  const config = {
    bin: 'sdkck',
    configDir,
    runHook: async () => ({failures: [], successes: []}),
  } as never
  const cmd = new AllowlistDisallow(argv, config)
  cmd.log = (message = '') => {
    lines.push(String(message))
  }

  return {cmd, output: () => lines.join('\n')}
}

describe('allowlist disallow', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, {recursive: true})
  })

  it('adds a disallow rule for the given pattern', async () => {
    const {cmd, output} = makeDisallow(['jira'], tmpDir)
    await cmd.run()

    expect(output()).to.contain('Added disallow rule for pattern "jira".')
    const saved = await readAllowlistConfig(tmpDir)
    expect(saved.rules).to.deep.equal([{action: 'disallow', pattern: 'jira'}])
  })

  it('adds a disallow rule with wildcard pattern', async () => {
    const {cmd} = makeDisallow(['jira *'], tmpDir)
    await cmd.run()

    const saved = await readAllowlistConfig(tmpDir)
    expect(saved.rules).to.deep.equal([{action: 'disallow', pattern: 'jira *'}])
  })

  it('does not duplicate an existing disallow rule', async () => {
    await writeAllowlistConfig(tmpDir, {rules: [{action: 'disallow', pattern: 'jira'}]})
    const {cmd, output} = makeDisallow(['jira'], tmpDir)
    await cmd.run()

    expect(output()).to.contain('already in the disallow list')
    const saved = await readAllowlistConfig(tmpDir)
    expect(saved.rules).to.have.length(1)
  })

  it('removes a conflicting allow rule when adding disallow', async () => {
    await writeAllowlistConfig(tmpDir, {rules: [{action: 'allow', pattern: 'jira'}]})
    const {cmd} = makeDisallow(['jira'], tmpDir)
    await cmd.run()

    const saved = await readAllowlistConfig(tmpDir)
    expect(saved.rules).to.deep.equal([{action: 'disallow', pattern: 'jira'}])
  })

  it('preserves unrelated rules when adding a new one', async () => {
    await writeAllowlistConfig(tmpDir, {rules: [{action: 'disallow', pattern: 'mysql'}]})
    const {cmd} = makeDisallow(['jira'], tmpDir)
    await cmd.run()

    const saved = await readAllowlistConfig(tmpDir)
    expect(saved.rules).to.have.length(2)
  })
})
