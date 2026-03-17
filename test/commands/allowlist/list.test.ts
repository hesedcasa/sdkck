import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {writeAllowlistConfig} from '../../../src/allowlist-config.js'
import AllowlistList from '../../../src/commands/allowlist/list.js'

function makeList(configDir: string): {cmd: AllowlistList; output: () => string} {
  const lines: string[] = []
  const config = {
    bin: 'sdkck',
    configDir,
    runHook: async () => ({failures: [], successes: []}),
  } as never
  const cmd = new AllowlistList([], config)
  cmd.log = (message = '') => {
    lines.push(String(message))
  }

  return {cmd, output: () => lines.join('\n')}
}

describe('allowlist list', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, {recursive: true})
  })

  it('reports no rules when config is empty', async () => {
    const {cmd, output} = makeList(tmpDir)
    await cmd.run()

    expect(output()).to.contain('No allowlist rules configured.')
  })

  it('lists allow rules', async () => {
    await writeAllowlistConfig(tmpDir, {rules: [{action: 'allow', pattern: 'jira'}]})
    const {cmd, output} = makeList(tmpDir)
    await cmd.run()

    expect(output()).to.contain('allow')
    expect(output()).to.contain('jira')
  })

  it('lists disallow rules', async () => {
    await writeAllowlistConfig(tmpDir, {rules: [{action: 'disallow', pattern: 'mysql *'}]})
    const {cmd, output} = makeList(tmpDir)
    await cmd.run()

    expect(output()).to.contain('disallow')
    expect(output()).to.contain('mysql *')
  })

  it('shows the rule count', async () => {
    await writeAllowlistConfig(tmpDir, {
      rules: [
        {action: 'allow', pattern: 'jira'},
        {action: 'disallow', pattern: 'mysql'},
      ],
    })
    const {cmd, output} = makeList(tmpDir)
    await cmd.run()

    expect(output()).to.contain('2 rules')
  })

  it('shows singular "rule" for a single entry', async () => {
    await writeAllowlistConfig(tmpDir, {rules: [{action: 'allow', pattern: '*'}]})
    const {cmd, output} = makeList(tmpDir)
    await cmd.run()

    expect(output()).to.contain('1 rule')
    expect(output()).to.not.contain('1 rules')
  })
})
