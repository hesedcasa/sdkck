import {expect} from 'chai'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import PermissionImport from '../../../src/commands/permission/import.js'
import {readPermissionConfig} from '../../../src/permission-config.js'

function makeImport(argv: string[], configDir: string): {cmd: PermissionImport; output: () => string} {
  const lines: string[] = []
  const config = {
    bin: 'sdkck',
    configDir,
    runHook: async () => ({failures: [], successes: []}),
  } as never
  const cmd = new PermissionImport(argv, config)
  cmd.log = (message = '') => {
    lines.push(String(message))
  }

  return {cmd, output: () => lines.join('\n')}
}

describe('permission import', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, {recursive: true})
  })

  it('imports rules from a valid JSON file', async () => {
    const rules = [
      {action: 'allow', pattern: 'jira'},
      {action: 'disallow', pattern: 'mysql'},
    ]
    const inFile = join(tmpDir, 'input.json')
    await writeFile(inFile, JSON.stringify({rules}), 'utf8')

    const {cmd, output} = makeImport([inFile], tmpDir)
    await cmd.run()

    expect(output()).to.contain('Imported 2 rules')
    const saved = await readPermissionConfig(tmpDir)
    expect(saved.rules).to.deep.equal(rules)
  })

  it('imports a single rule with correct singular message', async () => {
    const inFile = join(tmpDir, 'input.json')
    await writeFile(inFile, JSON.stringify({rules: [{action: 'allow', pattern: '*'}]}), 'utf8')

    const {cmd, output} = makeImport([inFile], tmpDir)
    await cmd.run()

    expect(output()).to.contain('Imported 1 rule')
    expect(output()).to.not.contain('Imported 1 rules')
  })

  it('throws for a non-existent file', async () => {
    const {cmd} = makeImport([join(tmpDir, 'missing.json')], tmpDir)
    let threw = false
    try {
      await cmd.run()
    } catch {
      threw = true
    }

    expect(threw).to.be.true
  })

  it('throws for a file with invalid JSON', async () => {
    const inFile = join(tmpDir, 'bad.json')
    await writeFile(inFile, 'not json', 'utf8')
    const {cmd} = makeImport([inFile], tmpDir)
    let threw = false
    try {
      await cmd.run()
    } catch {
      threw = true
    }

    expect(threw).to.be.true
  })

  it('throws when the rules field is missing', async () => {
    const inFile = join(tmpDir, 'noarray.json')
    await writeFile(inFile, JSON.stringify({somethingElse: []}), 'utf8')
    const {cmd} = makeImport([inFile], tmpDir)
    let threw = false
    try {
      await cmd.run()
    } catch {
      threw = true
    }

    expect(threw).to.be.true
  })

  it('throws when a rule has an invalid action', async () => {
    const inFile = join(tmpDir, 'badaction.json')
    await writeFile(inFile, JSON.stringify({rules: [{action: 'unknown', pattern: 'jira'}]}), 'utf8')
    const {cmd} = makeImport([inFile], tmpDir)
    let threw = false
    try {
      await cmd.run()
    } catch {
      threw = true
    }

    expect(threw).to.be.true
  })
})
