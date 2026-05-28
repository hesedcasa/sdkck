import {Errors} from '@oclif/core'
import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import hook from '../../../src/hooks/prerun/check-permission.js'
import {writePermissionConfig} from '../../../src/permission-config.js'
import {readUsageSync} from '../../../src/usage-tracker.js'

type HookOpts = Parameters<typeof hook>[0]

function makeOpts(configDir: string, commandId: string, topicSeparator = ' '): HookOpts {
  return {
    argv: [],
    Command: {id: commandId} as HookOpts['Command'],
    config: {configDir, topicSeparator} as unknown as HookOpts['config'],
    context: {} as HookOpts['context'],
  }
}

describe('prerun/check-permission hook', () => {
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

  it('does nothing when no rule matches (default allow)', async () => {
    await writePermissionConfig(tmpDir, {rules: [{pattern: 'mysql'}]})
    const opts = makeOpts(tmpDir, 'jira issue')
    await hook.call({} as never, opts) // should not throw
  })

  it('throws CLIError when a command matches a disallow rule', async () => {
    await writePermissionConfig(tmpDir, {rules: [{pattern: 'mysql'}]})
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
    await writePermissionConfig(tmpDir, {rules: [{pattern: 'jira *'}]})
    const opts = makeOpts(tmpDir, 'jira issue create')
    try {
      await hook.call({} as never, opts)
      expect.fail('should have thrown')
    } catch (error: unknown) {
      expect(error).to.be.instanceOf(Errors.CLIError)
    }
  })

  it('throws when disallow * blocks all commands', async () => {
    await writePermissionConfig(tmpDir, {rules: [{pattern: '*'}]})
    const opts = makeOpts(tmpDir, 'mysql query')
    try {
      await hook.call({} as never, opts)
      expect.fail('should have thrown')
    } catch (error: unknown) {
      expect(error).to.be.instanceOf(Errors.CLIError)
    }
  })

  it('records usage for an allowed command', async () => {
    const opts = makeOpts(tmpDir, 'jira:issue-get')
    await hook.call({} as never, opts)
    // recordUsage is fire-and-forget; wait for async I/O to settle
    await new Promise<void>((resolve) => { setTimeout(resolve, 50) })
    const usage = readUsageSync(tmpDir)
    expect(usage['jira:issue-get']?.count).to.equal(1)
  })

  it('does not record usage for a blocked command', async () => {
    await writePermissionConfig(tmpDir, {rules: [{pattern: 'blocked'}]})
    const opts = makeOpts(tmpDir, 'blocked:cmd')
    await hook.call({} as never, opts).catch(() => {})
    await new Promise<void>((resolve) => { setTimeout(resolve, 50) })
    const usage = readUsageSync(tmpDir)
    expect(usage['blocked:cmd']).to.be.undefined
  })

  it('blocks a colon-separated command ID (as stored by external plugins)', async () => {
    await writePermissionConfig(tmpDir, {rules: [{pattern: 'jira'}]})
    const opts = makeOpts(tmpDir, 'jira:issue:assign')
    try {
      await hook.call({} as never, opts)
      expect.fail('should have thrown')
    } catch (error: unknown) {
      expect(error).to.be.instanceOf(Errors.CLIError)
      expect((error as Errors.CLIError).message).to.contain('"jira issue assign"')
    }
  })
})
