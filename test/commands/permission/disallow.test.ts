import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import PermissionDisallow from '../../../src/commands/permission/disallow.js'
import {readPermissionConfig, writePermissionConfig} from '../../../src/permission-config.js'

function makeDisallow(argv: string[], configDir: string): {cmd: PermissionDisallow; output: () => string} {
  const lines: string[] = []
  const config = {
    bin: 'sdkck',
    configDir,
    runHook: async () => ({failures: [], successes: []}),
  } as never
  const cmd = new PermissionDisallow(argv, config)
  cmd.log = (message = '') => {
    lines.push(String(message))
  }

  return {cmd, output: () => lines.join('\n')}
}

describe('permission disallow', () => {
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

    expect(output()).to.contain('Added disallow rule for "jira".')
    const saved = await readPermissionConfig(tmpDir)
    expect(saved.rules).to.deep.equal([{pattern: 'jira'}])
  })

  it('adds a disallow rule with wildcard pattern', async () => {
    const {cmd} = makeDisallow(['jira *'], tmpDir)
    await cmd.run()

    const saved = await readPermissionConfig(tmpDir)
    expect(saved.rules).to.deep.equal([{pattern: 'jira *'}])
  })

  it('does not duplicate an existing disallow rule', async () => {
    await writePermissionConfig(tmpDir, {rules: [{pattern: 'jira'}]})
    const {cmd, output} = makeDisallow(['jira'], tmpDir)
    await cmd.run()

    expect(output()).to.contain('already in the disallow list')
    const saved = await readPermissionConfig(tmpDir)
    expect(saved.rules).to.have.length(1)
  })

  it('preserves unrelated rules when adding a new one', async () => {
    await writePermissionConfig(tmpDir, {rules: [{pattern: 'mysql'}]})
    const {cmd} = makeDisallow(['jira'], tmpDir)
    await cmd.run()

    const saved = await readPermissionConfig(tmpDir)
    expect(saved.rules).to.have.length(2)
  })
})
