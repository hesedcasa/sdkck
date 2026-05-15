import type {Command} from '@oclif/core'
import type {Config} from '@oclif/core/interfaces'

import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {sdkck, SdkckExecutionError} from '../src/api.js'
import {writePermissionConfig} from '../src/permission-config.js'

interface CmdSpec {
  args?: Record<string, unknown>
  body: (instance: {argv: string[]; log(msg?: string): void}) => Promise<unknown> | unknown
  flags?: Record<string, unknown>
  id: string
  staticProps?: Record<string, unknown>
}

function makeCmd(spec: CmdSpec): Command.Loadable {
  const Klass = class {
    argv: string[]
    config: Config
    log = (_msg?: string) => {}
    warn = String

    constructor(argv: string[], config: Config) {
      this.argv = argv
      this.config = config
    }

    async run() {
      return spec.body(this as {argv: string[]; log(msg?: string): void})
    }
  }

  for (const [k, v] of Object.entries(spec.staticProps ?? {})) {
    ;(Klass as unknown as Record<string, unknown>)[k] = v
  }

  return {
    aliases: [],
    args: spec.args ?? {},
    description: '',
    flags: spec.flags ?? {},
    hidden: false,
    id: spec.id,
    async load() {
      return Klass as unknown as typeof Command
    },
    pluginName: 'sdkck',
    pluginType: 'core',
    strict: true,
    summary: '',
  } as unknown as Command.Loadable
}

function makeConfig(commands: Command.Loadable[], configDir: string): Config {
  return {commands, configDir, topicSeparator: ' '} as unknown as Config
}

describe('sdkck.commands.run', () => {
  let configDir: string

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'sdkck-run-'))
  })

  afterEach(async () => {
    await rm(configDir, {force: true, recursive: true})
  })

  it('runs a command and captures log output', async () => {
    const cfg = makeConfig(
      [makeCmd({body(i) { i.log('hi') }, id: 'hello'})],
      configDir,
    )

    const result = await sdkck.commands.run(cfg, 'hello')
    expect(result.output).to.equal('hi')
    expect(result.error).to.be.undefined
  })

  it('accepts both colon and space id forms', async () => {
    const cfg = makeConfig(
      [makeCmd({body(i) { i.log('ok') }, id: 'api:list'})],
      configDir,
    )

    expect((await sdkck.commands.run(cfg, 'api:list')).output).to.equal('ok')
    expect((await sdkck.commands.run(cfg, 'api list')).output).to.equal('ok')
  })

  it('throws SdkckExecutionError with code command_not_found for unknown id', async () => {
    const cfg = makeConfig([], configDir)
    try {
      await sdkck.commands.run(cfg, 'nope')
      expect.fail('expected throw')
    } catch (error) {
      expect(error).to.be.instanceOf(SdkckExecutionError)
      expect((error as SdkckExecutionError).code).to.equal('command_not_found')
    }
  })

  it('blocks sensitive commands by default', async () => {
    const cfg = makeConfig(
      [makeCmd({body(i) { i.log('ran') }, id: 'api:auth', staticProps: {sensitive: true}})],
      configDir,
    )

    try {
      await sdkck.commands.run(cfg, 'api:auth')
      expect.fail('expected throw')
    } catch (error) {
      expect((error as SdkckExecutionError).code).to.equal('sensitive_denied')
    }
  })

  it('allows sensitive commands with allowSensitive: true', async () => {
    const cfg = makeConfig(
      [makeCmd({body(i) { i.log('ran') }, id: 'api:auth', staticProps: {sensitive: true}})],
      configDir,
    )

    const result = await sdkck.commands.run(cfg, 'api:auth', {}, {allowSensitive: true})
    expect(result.output).to.equal('ran')
  })

  it('blocks disallowed commands by default', async () => {
    await writePermissionConfig(configDir, {rules: [{action: 'disallow', pattern: 'api list'}]})
    const cfg = makeConfig(
      [makeCmd({body(i) { i.log('ran') }, id: 'api:list'})],
      configDir,
    )

    try {
      await sdkck.commands.run(cfg, 'api:list')
      expect.fail('expected throw')
    } catch (error) {
      expect((error as SdkckExecutionError).code).to.equal('permission_denied')
    }
  })

  it('allows disallowed commands with allowDisallowed: true', async () => {
    await writePermissionConfig(configDir, {rules: [{action: 'disallow', pattern: 'api list'}]})
    const cfg = makeConfig(
      [makeCmd({body(i) { i.log('ran') }, id: 'api:list'})],
      configDir,
    )

    const result = await sdkck.commands.run(cfg, 'api:list', {}, {allowDisallowed: true})
    expect(result.output).to.equal('ran')
  })

  it('returns {error} on runtime failure (does not throw)', async () => {
    const cfg = makeConfig(
      [makeCmd({body() { throw new Error('kaboom') }, id: 'boom'})],
      configDir,
    )

    const result = await sdkck.commands.run(cfg, 'boom')
    expect(result.error).to.equal('kaboom')
  })

  it('passes args record through buildArgv', async () => {
    const cfg = makeConfig(
      [
        makeCmd({
          args: {name: {required: true}},
          body(i) {
            i.log(i.argv.join(' '))
          },
          flags: {loud: {type: 'boolean'}},
          id: 'echo',
        }),
      ],
      configDir,
    )

    const result = await sdkck.commands.run(cfg, 'echo', {loud: true, name: 'allen'})
    expect(result.output).to.equal('allen --loud')
  })

  it('serializes JSON return value into output', async () => {
    const cfg = makeConfig(
      [makeCmd({body() { return {n: 1, ok: true} }, id: 'data'})],
      configDir,
    )

    const result = await sdkck.commands.run(cfg, 'data')
    expect(JSON.parse(result.output)).to.deep.equal({n: 1, ok: true})
  })

  it('does not interleave output across concurrent runs', async () => {
    const cfg = makeConfig(
      [
        makeCmd({async body(i) { await new Promise((r) => { setTimeout(r, 5) }); i.log('AAA') }, id: 'a'}),
        makeCmd({body(i) { i.log('BBB') }, id: 'b'}),
      ],
      configDir,
    )

    const [a, b] = await Promise.all([sdkck.commands.run(cfg, 'a'), sdkck.commands.run(cfg, 'b')])
    expect(a.output).to.equal('AAA')
    expect(b.output).to.equal('BBB')
  })
})
