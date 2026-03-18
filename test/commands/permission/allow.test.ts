import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import PermissionAllow from '../../../src/commands/permission/allow.js'
import {readPermissionConfig, writePermissionConfig} from '../../../src/permission-config.js'

function makeAllow(argv: string[], configDir: string): {cmd: PermissionAllow; output: () => string} {
  const lines: string[] = []
  const config = {
    bin: 'sdkck',
    configDir,
    runHook: async () => ({failures: [], successes: []}),
  } as never
  const cmd = new PermissionAllow(argv, config)
  cmd.log = (message = '') => {
    lines.push(String(message))
  }

  return {cmd, output: () => lines.join('\n')}
}

describe('permission allow', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, {recursive: true})
  })

  it('adds an allow rule for the given pattern', async () => {
    const {cmd, output} = makeAllow(['jira'], tmpDir)
    await cmd.run()

    expect(output()).to.contain('Added allow rule for "jira".')
    const saved = await readPermissionConfig(tmpDir)
    expect(saved.rules).to.deep.equal([{action: 'allow', pattern: 'jira'}])
  })

  it('adds an allow rule with wildcard pattern', async () => {
    const {cmd} = makeAllow(['jira *'], tmpDir)
    await cmd.run()

    const saved = await readPermissionConfig(tmpDir)
    expect(saved.rules).to.deep.equal([{action: 'allow', pattern: 'jira *'}])
  })

  it('does not duplicate an existing allow rule', async () => {
    await writePermissionConfig(tmpDir, {rules: [{action: 'allow', pattern: 'jira'}]})
    const {cmd, output} = makeAllow(['jira'], tmpDir)
    await cmd.run()

    expect(output()).to.contain('already in the allow list')
    const saved = await readPermissionConfig(tmpDir)
    expect(saved.rules).to.have.length(1)
  })

  it('removes a conflicting disallow rule when adding allow', async () => {
    await writePermissionConfig(tmpDir, {rules: [{action: 'disallow', pattern: 'jira'}]})
    const {cmd} = makeAllow(['jira'], tmpDir)
    await cmd.run()

    const saved = await readPermissionConfig(tmpDir)
    expect(saved.rules).to.deep.equal([{action: 'allow', pattern: 'jira'}])
  })

  it('preserves unrelated rules when adding a new one', async () => {
    await writePermissionConfig(tmpDir, {rules: [{action: 'allow', pattern: 'mysql'}]})
    const {cmd} = makeAllow(['jira'], tmpDir)
    await cmd.run()

    const saved = await readPermissionConfig(tmpDir)
    expect(saved.rules).to.have.length(2)
  })
})
