import {Errors} from '@oclif/core'
import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import hook from '../../../src/hooks/init/apply-permission.js'
import {writePermissionConfig} from '../../../src/permission-config.js'

type HookOpts = Parameters<typeof hook>[0]

function makeCommands(ids: string[]): Map<string, {hidden: boolean; id: string}> {
  return new Map(ids.map((id) => [id, {hidden: false, id}]))
}

function hiddenIds(commands: Map<string, {hidden: boolean; id: string}>): string[] {
  return [...commands.entries()].filter(([, c]) => c.hidden).map(([id]) => id)
}

function makeTopics(ids: string[]): Map<string, {hidden: boolean; name: string}> {
  return new Map(ids.map((id) => [id, {hidden: false, name: id}]))
}

function makeOpts(
  configDir: string,
  commandIds: string[],
  invokedId?: string,
  topicIds: string[] = [],
): {
  commands: Map<string, {hidden: boolean; id: string}>
  opts: HookOpts
  topics: Map<string, {hidden: boolean; name: string}>
} {
  const commands = makeCommands(commandIds)
  const topics = makeTopics(topicIds)
  const opts: HookOpts = {
    argv: [],
    config: {
      _commands: commands,
      _topics: topics,
      configDir,
      topicSeparator: ' ',
    } as unknown as HookOpts['config'],
    context: {} as HookOpts['context'],
    id: invokedId,
  }
  return {commands, opts, topics}
}

describe('init/apply-permission hook', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, {recursive: true})
  })

  it('does nothing when no rules are configured', async () => {
    const {commands, opts} = makeOpts(tmpDir, ['jira issue', 'mysql query'])
    await hook.call({} as never, opts)
    expect(hiddenIds(commands)).to.deep.equal([])
  })

  it('hides a command that matches a disallow rule', async () => {
    await writePermissionConfig(tmpDir, {rules: [{action: 'disallow', pattern: 'mysql'}]})
    const {commands, opts} = makeOpts(tmpDir, ['jira issue', 'mysql query'])
    await hook.call({} as never, opts)
    expect(hiddenIds(commands)).to.deep.equal(['mysql query'])
  })

  it('hides all commands matching a wildcard disallow rule', async () => {
    await writePermissionConfig(tmpDir, {rules: [{action: 'disallow', pattern: 'jira *'}]})
    const {commands, opts} = makeOpts(tmpDir, ['jira issue', 'jira project', 'mysql query'])
    await hook.call({} as never, opts)
    expect(hiddenIds(commands)).to.deep.equal(['jira issue', 'jira project'])
  })

  it('does not hide commands that match an allow rule', async () => {
    await writePermissionConfig(tmpDir, {rules: [{action: 'allow', pattern: 'jira'}]})
    const {commands, opts} = makeOpts(tmpDir, ['jira issue', 'mysql query'])
    await hook.call({} as never, opts)
    expect(hiddenIds(commands)).to.deep.equal([])
  })

  it('first matching rule wins — allow before disallow', async () => {
    await writePermissionConfig(tmpDir, {
      rules: [
        {action: 'allow', pattern: 'jira issue'},
        {action: 'disallow', pattern: 'jira'},
      ],
    })
    const {commands, opts} = makeOpts(tmpDir, ['jira issue', 'jira project'])
    await hook.call({} as never, opts)
    // 'jira issue' matched allow first → not hidden
    // 'jira project' matched disallow → hidden
    expect(hiddenIds(commands)).to.deep.equal(['jira project'])
  })

  it('hides all commands when disallow * is the only rule', async () => {
    await writePermissionConfig(tmpDir, {rules: [{action: 'disallow', pattern: '*'}]})
    const {commands, opts} = makeOpts(tmpDir, ['jira issue', 'mysql query', 'help'])
    await hook.call({} as never, opts)
    expect(hiddenIds(commands)).to.deep.equal(['jira issue', 'mysql query', 'help'])
  })

  it('commands with no matching rule are left untouched', async () => {
    await writePermissionConfig(tmpDir, {rules: [{action: 'disallow', pattern: 'mysql'}]})
    const {commands, opts} = makeOpts(tmpDir, ['jira issue', 'help'])
    await hook.call({} as never, opts)
    expect(hiddenIds(commands)).to.deep.equal([])
  })

  it('hides colon-separated command IDs (as stored by external plugins)', async () => {
    await writePermissionConfig(tmpDir, {rules: [{action: 'disallow', pattern: 'jira'}]})
    const {commands, opts} = makeOpts(tmpDir, ['jira:issue:assign', 'jira:board:list', 'mysql:query'])
    await hook.call({} as never, opts)
    expect(hiddenIds(commands)).to.deep.equal(['jira:issue:assign', 'jira:board:list'])
  })

  it('colon-separated wildcard disallow hides matching commands', async () => {
    await writePermissionConfig(tmpDir, {rules: [{action: 'disallow', pattern: 'jira *'}]})
    const {commands, opts} = makeOpts(tmpDir, ['jira:issue:assign', 'jira:board:list', 'mysql:query'])
    await hook.call({} as never, opts)
    expect(hiddenIds(commands)).to.deep.equal(['jira:issue:assign', 'jira:board:list'])
  })

  it('exits when the invoked command is disallowed', async () => {
    await writePermissionConfig(tmpDir, {rules: [{action: 'disallow', pattern: 'jira'}]})
    const {commands, opts} = makeOpts(tmpDir, ['jira issue get', 'mysql query'], 'jira issue get')
    try {
      await hook.call({} as never, opts)
      expect.fail('should have thrown')
    } catch (error: unknown) {
      expect(error).to.be.instanceOf(Errors.ExitError)
      expect((error as Errors.ExitError).oclif.exit).to.equal(2)
    }

    expect(hiddenIds(commands)).to.deep.equal(['jira issue get'])
  })

  it('exits for colon-separated invoked command id', async () => {
    await writePermissionConfig(tmpDir, {rules: [{action: 'disallow', pattern: 'jira'}]})
    const {commands, opts} = makeOpts(tmpDir, ['jira:issue:get', 'mysql:query'], 'jira:issue:get')
    try {
      await hook.call({} as never, opts)
      expect.fail('should have thrown')
    } catch (error: unknown) {
      expect(error).to.be.instanceOf(Errors.ExitError)
      expect((error as Errors.ExitError).oclif.exit).to.equal(2)
    }

    expect(hiddenIds(commands)).to.deep.equal(['jira:issue:get'])
  })

  it('does not throw when the invoked command is allowed', async () => {
    await writePermissionConfig(tmpDir, {rules: [{action: 'disallow', pattern: 'mysql'}]})
    const {opts} = makeOpts(tmpDir, ['jira issue get', 'mysql query'], 'jira issue get')
    await hook.call({} as never, opts) // should not throw
  })

  it('hides topics matching a disallow rule', async () => {
    await writePermissionConfig(tmpDir, {rules: [{action: 'disallow', pattern: 'jira'}]})
    const {opts, topics} = makeOpts(tmpDir, [], undefined, ['jira', 'jira issue', 'mysql'])
    await hook.call({} as never, opts)
    const hiddenTopicIds = [...topics.entries()].filter(([, t]) => t.hidden).map(([id]) => id)
    expect(hiddenTopicIds).to.deep.equal(['jira', 'jira issue'])
  })

  it('blocks `help <target>` when the target is disallowed', async () => {
    await writePermissionConfig(tmpDir, {rules: [{action: 'disallow', pattern: 'jira'}]})
    const {opts} = makeOpts(tmpDir, ['jira issue create', 'mysql query'], undefined, ['jira issue', 'mysql'])
    opts.id = 'help'
    opts.argv = ['jira', 'issue', 'create']
    try {
      await hook.call({} as never, opts)
      expect.fail('should have thrown')
    } catch (error: unknown) {
      expect(error).to.be.instanceOf(Errors.ExitError)
    }
  })
})
