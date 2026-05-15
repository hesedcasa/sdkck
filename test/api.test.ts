import type {Command} from '@oclif/core'
import type {Config} from '@oclif/core/interfaces'

import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {isSensitiveCommand, sdkck, SENSITIVE_SEGMENTS} from '../src/api.js'
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
  staticProps?: Record<string, unknown>
  summary?: string
}

function cmd(o: CmdOverrides): Command.Loadable {
  const CmdClass = class extends (class {} as unknown as typeof Command) {
    async run() {}
  }
  for (const [k, v] of Object.entries(o.staticProps ?? {})) {
    ;(CmdClass as unknown as Record<string, unknown>)[k] = v
  }

  return {
    aliases: o.aliases ?? [],
    args: o.args ?? {},
    description: o.description ?? '',
    flags: o.flags ?? {},
    hidden: o.hidden ?? false,
    id: o.id,
    async load() {
      return CmdClass as unknown as typeof Command
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

describe('api', () => {
describe('SENSITIVE_SEGMENTS', () => {
  it('contains expected auth-related segments', () => {
    expect(SENSITIVE_SEGMENTS.has('auth')).to.be.true
    expect(SENSITIVE_SEGMENTS.has('login')).to.be.true
    expect(SENSITIVE_SEGMENTS.has('logout')).to.be.true
    expect(SENSITIVE_SEGMENTS.has('credential')).to.be.true
    expect(SENSITIVE_SEGMENTS.has('credentials')).to.be.true
    expect(SENSITIVE_SEGMENTS.has('secret')).to.be.true
    expect(SENSITIVE_SEGMENTS.has('secrets')).to.be.true
    expect(SENSITIVE_SEGMENTS.has('token')).to.be.true
    expect(SENSITIVE_SEGMENTS.has('tokens')).to.be.true
  })
})

describe('isSensitiveCommand', () => {
  it('returns true when class has static sensitive = true', () => {
    const CmdClass = {sensitive : true,} as unknown as {sensitive?: boolean}
    expect(isSensitiveCommand('foo:bar', CmdClass)).to.be.true
  })

  it('returns false when class has static sensitive = false (escape hatch)', () => {
    const CmdClass = {sensitive : false,} as unknown as {sensitive?: boolean}
    // id segment 'login' would normally match the pattern fallback
    expect(isSensitiveCommand('foo:login', CmdClass)).to.be.false
  })

  it('falls back to pattern match when sensitive is undefined', () => {
    const CmdClass = class {} as unknown as {sensitive?: boolean}
    expect(isSensitiveCommand('api:auth', CmdClass)).to.be.true
    expect(isSensitiveCommand('foo:login', CmdClass)).to.be.true
  })

  it('pattern match is per-segment (no substring match)', () => {
    const CmdClass = class {} as unknown as {sensitive?: boolean}
    expect(isSensitiveCommand('authority:list', CmdClass)).to.be.false
  })

  it('pattern match is case-insensitive', () => {
    const CmdClass = class {} as unknown as {sensitive?: boolean}
    expect(isSensitiveCommand('api:Auth', CmdClass)).to.be.true
  })

  it('returns false when neither flag nor pattern matches', () => {
    const CmdClass = class {} as unknown as {sensitive?: boolean}
    expect(isSensitiveCommand('api:list', CmdClass)).to.be.false
  })
})

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
      [
        cmd({id: 'api:list', summary: 'List specs'}),
        cmd({id: 'permission:list', summary: 'List rules'}),
      ],
      configDir,
    )

    const result = await sdkck.commands.list(cfg)

    expect(result).to.have.length(2)
    const apiList = result.find((c) => c.id === 'api:list')
    expect(apiList).to.exist
    expect(apiList?.displayId).to.equal('api list')
    expect(apiList?.summary).to.equal('List specs')
    expect(apiList?.topic).to.equal('api')
    expect(apiList?.isSensitive).to.be.false
    expect(apiList?.isPermitted).to.be.true
  })

  it('excludes hidden commands by default; includeHidden returns them', async () => {
    const cfg = makeConfig(
      [cmd({hidden: false, id: 'a'}), cmd({hidden: true, id: 'b'})],
      configDir,
    )

    expect((await sdkck.commands.list(cfg)).map((c) => c.id)).to.deep.equal(['a'])
    expect((await sdkck.commands.list(cfg, {includeHidden: true})).map((c) => c.id)).to.deep.equal(['a', 'b'])
  })

  it('excludes sensitive commands by default', async () => {
    const cfg = makeConfig([cmd({id: 'api:list'}), cmd({id: 'api:auth'})], configDir)

    expect((await sdkck.commands.list(cfg)).map((c) => c.id)).to.deep.equal(['api:list'])

    const all = await sdkck.commands.list(cfg, {includeSensitive: true})
    expect(all.map((c) => c.id)).to.deep.equal(['api:auth', 'api:list'])
    expect(all.find((c) => c.id === 'api:auth')?.isSensitive).to.be.true
  })

  it('respects static sensitive = false escape hatch on a pattern-matched id', async () => {
    const cfg = makeConfig(
      [cmd({id: 'foo:login', staticProps: {sensitive: false}})],
      configDir,
    )

    const all = await sdkck.commands.list(cfg)
    expect(all.map((c) => c.id)).to.deep.equal(['foo:login'])
    expect(all[0].isSensitive).to.be.false
  })

  it('applies permission allowlist; includeDisallowed surfaces blocked with isPermitted=false', async () => {
    await writePermissionConfig(configDir, {rules: [{action: 'disallow', pattern: 'api list'}]})
    const cfg = makeConfig([cmd({id: 'api:list'}), cmd({id: 'api:remove'})], configDir)

    expect((await sdkck.commands.list(cfg)).map((c) => c.id)).to.deep.equal(['api:remove'])

    const all = await sdkck.commands.list(cfg, {includeDisallowed: true})
    expect(all.map((c) => c.id)).to.deep.equal(['api:list', 'api:remove'])
    expect(all.find((c) => c.id === 'api:list')?.isPermitted).to.be.false
  })

  it('filters by topic', async () => {
    const cfg = makeConfig(
      [cmd({id: 'api:list'}), cmd({id: 'api:remove'}), cmd({id: 'permission:list'})],
      configDir,
    )

    const result = await sdkck.commands.list(cfg, {topic: 'api'})
    expect(result.map((c) => c.id)).to.deep.equal(['api:list', 'api:remove'])
  })

  it('does not crash when a single command fails to load', async () => {
    const broken = {
      aliases: [],
      args: {},
      flags: {},
      hidden: false,
      id: 'broken',
      async load() {
        throw new Error('boom')
      },
      pluginName: 'sdkck',
      pluginType: 'core',
      strict: true,
      summary: '',
    } as unknown as Command.Loadable

    const cfg = makeConfig([broken, cmd({id: 'ok'})], configDir)

    const result = await sdkck.commands.list(cfg)
    expect(result.map((c) => c.id)).to.deep.equal(['ok'])
  })

  it('freezes returned entries', async () => {
    const cfg = makeConfig([cmd({id: 'ok'})], configDir)
    const [entry] = await sdkck.commands.list(cfg)
    expect(Object.isFrozen(entry)).to.be.true
    expect(Object.isFrozen(entry.args)).to.be.true
    expect(Object.isFrozen(entry.flags)).to.be.true
  })

  it('sorts results by displayId', async () => {
    const cfg = makeConfig(
      [cmd({id: 'z:cmd'}), cmd({id: 'a:cmd'}), cmd({id: 'm:cmd'})],
      configDir,
    )

    const result = await sdkck.commands.list(cfg)
    expect(result.map((c) => c.displayId)).to.deep.equal(['a cmd', 'm cmd', 'z cmd'])
  })
})
})
