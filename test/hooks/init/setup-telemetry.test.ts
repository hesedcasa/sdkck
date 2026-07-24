import {Command} from '@oclif/core'
import {expect} from 'chai'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import hook from '../../../src/hooks/init/setup-telemetry.js'
import {resetTelemetryForTests, shutdownTelemetry} from '../../../src/telemetry.js'

type HookOpts = Parameters<typeof hook>[0]

function makeOpts(configDir: string): HookOpts {
  return {
    argv: [],
    config: {configDir, version: '9.9.9'} as unknown as HookOpts['config'],
    context: {} as HookOpts['context'],
    id: undefined,
  }
}

type TraceEntry = {
  attributes: Record<string, string>
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let origRun: any

  beforeEach(async () => {
    resetTelemetryForTests()
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-telemetry-hook-'))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    origRun = (Command.prototype as any)._run
    delete process.env.OTEL_SDK_DISABLED
  })

  afterEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(Command.prototype as any)._run = origRun
    await shutdownTelemetry()
    resetTelemetryForTests()
    await rm(tmpDir, {force: true, recursive: true})
  })

  it('wraps Command.prototype._run and traces a command invocation', async () => {
    // Install a controllable stub as the "original" so the wrapper closes over
    // it rather than the real _run (which needs a full command lifecycle).
    const stubThisCalls: unknown[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(Command.prototype as any)._run = async function (this: unknown): Promise<string> {
      stubThisCalls.push(this)
      return 'done'
    }

    await hook.call({} as never, makeOpts(tmpDir))

    // The hook replaced _run with a wrapper.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = (Command.prototype as any)._run as (this: unknown) => Promise<unknown>

    const fakeCommand = {argv: ['--x'], ctor: {id: 'fake cmd', plugin: {name: 'fake-plugin'}}, id: 'fake cmd'}
    const result = await wrapped.call(fakeCommand)

    expect(result).to.equal('done')
    expect(stubThisCalls).to.deep.equal([fakeCommand])

    const traces = await readTraces(tmpDir)
    expect(traces).to.have.length(1)
    expect(traces[0].name).to.equal('command fake cmd')
    expect(traces[0].attributes['command.id']).to.equal('fake cmd')
    expect(traces[0].attributes['command.plugin']).to.equal('fake-plugin')
    expect(traces[0].status.code).to.equal(1) // OK
  })

  it('produces no telemetry when OTEL_SDK_DISABLED is set', async () => {
    process.env.OTEL_SDK_DISABLED = 'true'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(Command.prototype as any)._run = async function (this: unknown): Promise<string> {
      return 'ok'
    }

    await hook.call({} as never, makeOpts(tmpDir))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = (Command.prototype as any)._run as (this: unknown) => Promise<unknown>
    const result = await wrapped.call({argv: [], ctor: {id: 'x'}, id: 'x'})

    // Callback still runs and returns its value untouched.
    expect(result).to.equal('ok')
    expect(await tracesFileExists(tmpDir)).to.equal(false)
  })
})
