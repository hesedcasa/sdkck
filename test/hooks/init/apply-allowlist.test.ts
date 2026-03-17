import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {writeAllowlistConfig} from '../../../src/allowlist-config.js'
import hook from '../../../src/hooks/init/apply-allowlist.js'

type HookOpts = Parameters<typeof hook>[0]

function makeCommands(ids: string[]): Map<string, {id: string}> {
  return new Map(ids.map((id) => [id, {id}]))
}

function makeOpts(
  configDir: string,
  commandIds: string[],
): {
  commands: Map<string, {id: string}>
  opts: HookOpts
} {
  const commands = makeCommands(commandIds)
  const opts: HookOpts = {
    argv: [],
    config: {
      _commands: commands,
      configDir,
    } as unknown as HookOpts['config'],
    context: {} as HookOpts['context'],
    id: undefined,
  }
  return {commands, opts}
}

describe('init/apply-allowlist hook', () => {
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
    expect([...commands.keys()]).to.deep.equal(['jira issue', 'mysql query'])
  })

  it('removes a command that matches a disallow rule', async () => {
    await writeAllowlistConfig(tmpDir, {rules: [{action: 'disallow', pattern: 'mysql'}]})
    const {commands, opts} = makeOpts(tmpDir, ['jira issue', 'mysql query'])
    await hook.call({} as never, opts)
    expect([...commands.keys()]).to.deep.equal(['jira issue'])
  })

  it('removes all commands matching a wildcard disallow rule', async () => {
    await writeAllowlistConfig(tmpDir, {rules: [{action: 'disallow', pattern: 'jira *'}]})
    const {commands, opts} = makeOpts(tmpDir, ['jira issue', 'jira project', 'mysql query'])
    await hook.call({} as never, opts)
    expect([...commands.keys()]).to.deep.equal(['mysql query'])
  })

  it('keeps commands that match an allow rule', async () => {
    await writeAllowlistConfig(tmpDir, {rules: [{action: 'allow', pattern: 'jira'}]})
    const {commands, opts} = makeOpts(tmpDir, ['jira issue', 'mysql query'])
    await hook.call({} as never, opts)
    expect([...commands.keys()]).to.deep.equal(['jira issue', 'mysql query'])
  })

  it('first matching rule wins — allow before disallow', async () => {
    await writeAllowlistConfig(tmpDir, {
      rules: [
        {action: 'allow', pattern: 'jira issue'},
        {action: 'disallow', pattern: 'jira'},
      ],
    })
    const {commands, opts} = makeOpts(tmpDir, ['jira issue', 'jira project'])
    await hook.call({} as never, opts)
    // 'jira issue' matched allow first → kept
    // 'jira project' matched disallow → removed
    expect([...commands.keys()]).to.deep.equal(['jira issue'])
  })

  it('removes all commands when disallow * is the only rule', async () => {
    await writeAllowlistConfig(tmpDir, {rules: [{action: 'disallow', pattern: '*'}]})
    const {commands, opts} = makeOpts(tmpDir, ['jira issue', 'mysql query', 'help'])
    await hook.call({} as never, opts)
    expect(commands.size).to.equal(0)
  })

  it('commands with no matching rule are left untouched', async () => {
    await writeAllowlistConfig(tmpDir, {rules: [{action: 'disallow', pattern: 'mysql'}]})
    const {commands, opts} = makeOpts(tmpDir, ['jira issue', 'help'])
    await hook.call({} as never, opts)
    expect([...commands.keys()]).to.deep.equal(['jira issue', 'help'])
  })
})
