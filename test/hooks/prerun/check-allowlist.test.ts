import {Errors} from '@oclif/core'
import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {writeAllowlistConfig} from '../../../src/allowlist-config.js'
import hook from '../../../src/hooks/prerun/check-allowlist.js'

type HookOpts = Parameters<typeof hook>[0]

function makeOpts(configDir: string, commandId: string): HookOpts {
  return {
    argv: [],
    Command: {id: commandId} as HookOpts['Command'],
    config: {configDir} as unknown as HookOpts['config'],
    context: {} as HookOpts['context'],
  }
}

describe('prerun/check-allowlist hook', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, {recursive: true})
  })

  it('does nothing when no rules are configured', async () => {
    const opts = makeOpts(tmpDir, 'jira issue')
    await hook.call({} as never, opts) // should not throw
  })

  it('does nothing when the command matches an allow rule', async () => {
    await writeAllowlistConfig(tmpDir, {rules: [{action: 'allow', pattern: 'jira'}]})
    const opts = makeOpts(tmpDir, 'jira issue')
    await hook.call({} as never, opts) // should not throw
  })

  it('does nothing when no rule matches (default allow)', async () => {
    await writeAllowlistConfig(tmpDir, {rules: [{action: 'disallow', pattern: 'mysql'}]})
    const opts = makeOpts(tmpDir, 'jira issue')
    await hook.call({} as never, opts) // should not throw
  })

  it('throws CLIError when a command matches a disallow rule', async () => {
    await writeAllowlistConfig(tmpDir, {rules: [{action: 'disallow', pattern: 'mysql'}]})
    const opts = makeOpts(tmpDir, 'mysql query')
    try {
      await hook.call({} as never, opts)
      expect.fail('should have thrown')
    } catch (error: unknown) {
      expect(error).to.be.instanceOf(Errors.CLIError)
      expect((error as Errors.CLIError).message).to.contain('"mysql query"')
    }
  })

  it('throws for a command matching a wildcard disallow rule', async () => {
    await writeAllowlistConfig(tmpDir, {rules: [{action: 'disallow', pattern: 'jira *'}]})
    const opts = makeOpts(tmpDir, 'jira issue create')
    try {
      await hook.call({} as never, opts)
      expect.fail('should have thrown')
    } catch (error: unknown) {
      expect(error).to.be.instanceOf(Errors.CLIError)
    }
  })

  it('first matching rule wins — allow before disallow', async () => {
    await writeAllowlistConfig(tmpDir, {
      rules: [
        {action: 'allow', pattern: 'jira issue'},
        {action: 'disallow', pattern: 'jira'},
      ],
    })
    // 'jira issue' matches allow first → no throw
    const opts = makeOpts(tmpDir, 'jira issue')
    await hook.call({} as never, opts)
  })

  it('throws when disallow * is set and no earlier allow matches', async () => {
    await writeAllowlistConfig(tmpDir, {
      rules: [
        {action: 'allow', pattern: 'help'},
        {action: 'disallow', pattern: '*'},
      ],
    })
    const opts = makeOpts(tmpDir, 'mysql query')
    try {
      await hook.call({} as never, opts)
      expect.fail('should have thrown')
    } catch (error: unknown) {
      expect(error).to.be.instanceOf(Errors.CLIError)
    }
  })
})
