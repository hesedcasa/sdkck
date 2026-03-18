import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import PermissionReset from '../../../src/commands/permission/reset.js'
import {readPermissionConfig, writePermissionConfig} from '../../../src/permission-config.js'

function makeReset(argv: string[], configDir: string): {cmd: PermissionReset; output: () => string} {
  const lines: string[] = []
  const config = {
    bin: 'sdkck',
    configDir,
    runHook: async () => ({failures: [], successes: []}),
  } as never
  const cmd = new PermissionReset(argv, config)
  cmd.log = (message = '') => {
    lines.push(String(message))
  }

  return {cmd, output: () => lines.join('\n')}
}

describe('permission reset', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, {recursive: true})
  })

  it('exits early when there are no rules', async () => {
    const {cmd, output} = makeReset(['--confirm'], tmpDir)
    await cmd.run()

    expect(output()).to.contain('No permission rules to reset.')
  })

  it('clears all rules when --confirm is passed', async () => {
    await writePermissionConfig(tmpDir, {
      rules: [
        {action: 'allow', pattern: 'jira'},
        {action: 'disallow', pattern: 'mysql'},
      ],
    })

    const {cmd, output} = makeReset(['--confirm'], tmpDir)
    await cmd.run()

    expect(output()).to.contain('All permission rules have been removed.')
    const saved = await readPermissionConfig(tmpDir)
    expect(saved.rules).to.deep.equal([])
  })

  it('cancels when the prompt response is not "yes"', async () => {
    await writePermissionConfig(tmpDir, {rules: [{action: 'allow', pattern: 'jira'}]})

    const {cmd, output} = makeReset([], tmpDir)
    // Override prompt to return a non-confirming answer
    cmd._prompt = async () => 'no'
    await cmd.run()

    expect(output()).to.contain('Reset cancelled.')
    const saved = await readPermissionConfig(tmpDir)
    expect(saved.rules).to.have.length(1)
  })

  it('proceeds when the prompt response is "yes"', async () => {
    await writePermissionConfig(tmpDir, {rules: [{action: 'allow', pattern: 'jira'}]})

    const {cmd, output} = makeReset([], tmpDir)
    cmd._prompt = async () => 'yes'
    await cmd.run()

    expect(output()).to.contain('All permission rules have been removed.')
    const saved = await readPermissionConfig(tmpDir)
    expect(saved.rules).to.deep.equal([])
  })
})
