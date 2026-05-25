import type {Command} from '@oclif/core'
import type {Config} from '@oclif/core/interfaces'

import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {sdkck} from '../src/api.js'
import {writePermissionConfig} from '../src/permission-config.js'

interface CmdOverrides {
  aliases?: string[]
  args?: Record<string, unknown>
  description?: string
  flags?: Record<string, unknown>
  hidden?: boolean
  id: string
  pluginName?: string
  pluginType?: 'core' | 'jit' | 'link' | 'user'
  summary?: string
}

function cmd(o: CmdOverrides): Command.Loadable {
  return {
    aliases: o.aliases ?? [],
    args: o.args ?? {},
    description: o.description ?? '',
    flags: o.flags ?? {},
    hidden: o.hidden ?? false,
    id: o.id,
    async load() {
      return class {
        async run() {}
      } as unknown as typeof Command
    },
    pluginName: o.pluginName ?? 'sdkck',
    pluginType: o.pluginType ?? 'core',
    strict: true,
    summary: o.summary ?? '',
  } as unknown as Command.Loadable
}

function makeConfig(commands: Command.Loadable[], configDir: string): Config {
  return {
    commands,
    configDir,
    topicSeparator: ' ',
  } as unknown as Config
}

describe('sdkck.commands.list', () => {
  let configDir: string

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'sdkck-api-test-'))
  })

  afterEach(async () => {
    await rm(configDir, {force: true, recursive: true})
  })

  it('returns one entry per command with expected shape', async () => {
    const cfg = makeConfig(
      [cmd({id: 'api:list', summary: 'List specs'}), cmd({id: 'permission:list', summary: 'List rules'})],
      configDir,
    )

    const result = await sdkck.commands.list(cfg)

    expect(result).to.have.length(2)
    const apiList = result.find((c) => c.id === 'api:list')
    expect(apiList).to.exist
    expect(apiList?.displayId).to.equal('api list')
    expect(apiList?.summary).to.equal('List specs')
    expect(apiList?.topic).to.equal('api')
    expect(apiList?.isPermitted).to.be.true
  })

  it('excludes hidden commands by default; includeHidden returns them', async () => {
    const cfg = makeConfig([cmd({hidden: false, id: 'a'}), cmd({hidden: true, id: 'b'})], configDir)

    expect((await sdkck.commands.list(cfg)).map((c) => c.id)).to.deep.equal(['a'])
    expect((await sdkck.commands.list(cfg, {includeHidden: true})).map((c) => c.id)).to.deep.equal(['a', 'b'])
  })

  it('applies permission allowlist; includeDisallowed surfaces blocked with isPermitted=false', async () => {
    await writePermissionConfig(configDir, {rules: [{pattern: 'api list'}]})
    const cfg = makeConfig([cmd({id: 'api:list'}), cmd({id: 'api:remove'})], configDir)

    expect((await sdkck.commands.list(cfg)).map((c) => c.id)).to.deep.equal(['api:remove'])

    const all = await sdkck.commands.list(cfg, {includeDisallowed: true})
    expect(all.map((c) => c.id)).to.deep.equal(['api:list', 'api:remove'])
    expect(all.find((c) => c.id === 'api:list')?.isPermitted).to.be.false
  })

  it('filters by topic', async () => {
    const cfg = makeConfig([cmd({id: 'api:list'}), cmd({id: 'api:remove'}), cmd({id: 'permission:list'})], configDir)

    const result = await sdkck.commands.list(cfg, {topic: 'api'})
    expect(result.map((c) => c.id)).to.deep.equal(['api:list', 'api:remove'])
  })

  it('freezes returned entries', async () => {
    const cfg = makeConfig([cmd({id: 'ok'})], configDir)
    const [entry] = await sdkck.commands.list(cfg)
    expect(Object.isFrozen(entry)).to.be.true
    expect(Object.isFrozen(entry.args)).to.be.true
    expect(Object.isFrozen(entry.flags)).to.be.true
  })

  it('sorts results by displayId', async () => {
    const cfg = makeConfig([cmd({id: 'z:cmd'}), cmd({id: 'a:cmd'}), cmd({id: 'm:cmd'})], configDir)

    const result = await sdkck.commands.list(cfg)
    expect(result.map((c) => c.displayId)).to.deep.equal(['a cmd', 'm cmd', 'z cmd'])
  })
})
