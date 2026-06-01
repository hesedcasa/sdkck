import {expect} from 'chai'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import PermissionExport from '../../../src/commands/permission/export.js'
import {writePermissionConfig} from '../../../src/permission-config.js'

function makeExport(argv: string[], configDir: string): {cmd: PermissionExport; output: () => string} {
  const lines: string[] = []
  const config = {
    bin: 'sdkck',
    configDir,
    runHook: async () => ({failures: [], successes: []}),
  } as never
  const cmd = new PermissionExport(argv, config)
  cmd.log = (message = '') => {
    lines.push(String(message))
  }

  return {cmd, output: () => lines.join('\n')}
}

describe('permission export', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, {recursive: true})
  })

  it('exports an empty config to a JSON file', async () => {
    const outFile = join(tmpDir, 'out.json')
    const {cmd, output} = makeExport([outFile], tmpDir)
    await cmd.run()

    expect(output()).to.contain('exported to')
    const content = JSON.parse(await readFile(outFile, 'utf8'))
    expect(content).to.deep.equal({rules: []})
  })

  it('exports existing rules to a JSON file', async () => {
    const rules = [{pattern: 'jira'}, {pattern: 'mysql *'}]
    await writePermissionConfig(tmpDir, {rules})

    const outFile = join(tmpDir, 'out.json')
    const {cmd} = makeExport([outFile], tmpDir)
    await cmd.run()

    const content = JSON.parse(await readFile(outFile, 'utf8'))
    expect(content.rules).to.deep.equal(rules)
  })
})
