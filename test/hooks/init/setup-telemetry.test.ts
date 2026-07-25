import {expect} from 'chai'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import hook from '../../../src/hooks/init/setup-telemetry.js'
import {resetTelemetryForTests, shutdownTelemetry} from '../../../src/telemetry.js'

type HookOpts = Parameters<typeof hook>[0]

// A minimal stand-in for oclif's Config: it exposes the two members the hook
// touches (`runCommand` and `findCommand`) plus the fields initTelemetry reads.
// Deliberately NOTHING here references Command.prototype — the whole point of
// instrumenting at runCommand is that it is agnostic to which @oclif/core copy
// a command class extends.
type FakeCommand = {id?: string; pluginName?: string}

function makeConfig(
  configDir: string,
  opts: {
    commands?: Record<string, FakeCommand>
    runCommand?: (id: string, argv?: string[], cachedCommand?: unknown) => Promise<unknown>
  } = {},
) {
  return {
    configDir,
    findCommand(id: string): FakeCommand | undefined {
      return opts.commands?.[id]
    },
    runCommand: opts.runCommand ?? (async (): Promise<string> => 'done'),
    version: '9.9.9',
  }
}

function makeOpts(config: ReturnType<typeof makeConfig>): HookOpts {
  return {
    argv: [],
    config: config as unknown as HookOpts['config'],
    context: {} as HookOpts['context'],
    id: undefined,
  }
}

type TraceEntry = {
  attributes: Record<string, number | string>
  name: string
  status: {code: number}
}

async function readTraces(configDir: string): Promise<TraceEntry[]> {
  const raw = await readFile(join(configDir, 'logs', 'otel-traces.jsonl'), 'utf8')
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TraceEntry)
}

async function tracesFileExists(configDir: string): Promise<boolean> {
  try {
    await readFile(join(configDir, 'logs', 'otel-traces.jsonl'), 'utf8')
    return true
  } catch {
    return false
  }
}

describe('init/setup-telemetry hook', () => {
  let tmpDir: string

  beforeEach(async () => {
    resetTelemetryForTests()
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-telemetry-hook-'))
    delete process.env.OTEL_SDK_DISABLED
  })

  afterEach(async () => {
    await shutdownTelemetry()
    resetTelemetryForTests()
    await rm(tmpDir, {force: true, recursive: true})
  })

  it('wraps config.runCommand and traces a command invocation, regardless of which @oclif/core the command uses', async () => {
    // The "original" runCommand records how it was called and returns a value.
    // It never goes through Command.prototype._run — mirroring a JIT/data-dir
    // plugin command that extends a different @oclif/core's Command.
    const calls: unknown[][] = []
    const original = async (...args: unknown[]): Promise<string> => {
      calls.push(args)
      return 'result'
    }

    const config = makeConfig(tmpDir, {
      commands: {'jira:issue': {id: 'jira:issue', pluginName: 'jira'}},
      runCommand: original as never,
    })

    await hook.call({} as never, makeOpts(config))

    // The hook replaced runCommand with an instrumenting wrapper.
    expect(config.runCommand).to.not.equal(original)

    const result = await config.runCommand('jira:issue', ['SATHREE-42869'])

    expect(result).to.equal('result')
    // The wrapper forwarded the exact arguments to the original.
    expect(calls).to.deep.equal([['jira:issue', ['SATHREE-42869'], null]])

    const traces = await readTraces(tmpDir)
    expect(traces).to.have.length(1)
    expect(traces[0].name).to.equal('command jira:issue')
    expect(traces[0].attributes['command.id']).to.equal('jira:issue')
    expect(traces[0].attributes['command.plugin']).to.equal('jira')
    // Safe by default: only the argument count.
    expect(traces[0].attributes['command.argc']).to.equal(1)
    expect(traces[0].status.code).to.equal(1) // OK
  })

  it('falls back to the raw id when the command is not resolvable (e.g. pre-install JIT run)', async () => {
    const config = makeConfig(tmpDir, {commands: {}})
    await hook.call({} as never, makeOpts(config))

    await config.runCommand('mysql:query', ['SELECT 1'])

    const traces = await readTraces(tmpDir)
    expect(traces).to.have.length(1)
    expect(traces[0].attributes['command.id']).to.equal('mysql:query')
    expect(traces[0].attributes['command.plugin']).to.equal(undefined)
  })

  it('does not wrap runCommand twice when the init hook fires more than once', async () => {
    const config = makeConfig(tmpDir)
    await hook.call({} as never, makeOpts(config))
    const wrappedOnce = config.runCommand
    await hook.call({} as never, makeOpts(config))
    expect(config.runCommand).to.equal(wrappedOnce)
  })

  it('produces no telemetry when OTEL_SDK_DISABLED is set', async () => {
    process.env.OTEL_SDK_DISABLED = 'true'
    const config = makeConfig(tmpDir)

    await hook.call({} as never, makeOpts(config))
    const result = await config.runCommand('x')

    // Callback still runs and returns its value untouched.
    expect(result).to.equal('done')
    expect(await tracesFileExists(tmpDir)).to.equal(false)
  })
})
