import {expect} from 'chai'
import {access, mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {
  initTelemetry,
  instrumentCommand,
  isTelemetryActive,
  resetTelemetryForTests,
  shutdownTelemetry,
} from '../src/telemetry.js'

type TraceEntry = {
  attributes: Record<string, string>
  durationMs: number
  events: Array<{attributes: Record<string, unknown>; name: string}>
  name: string
  status: {code: number; message?: string}
}

type MetricEntry = {
  attributes: Record<string, string>
  name: string
  unit: string
  value: unknown
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

async function readLines<T>(file: string): Promise<T[]> {
  const raw = await readFile(file, 'utf8')
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

describe('telemetry', () => {
  let tmpDir: string

  beforeEach(async () => {
    resetTelemetryForTests()
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-telemetry-'))
    delete process.env.OTEL_SDK_DISABLED
    delete process.env.SDKCK_OTEL_DISABLED
    delete process.env.OTEL_TRACES_EXPORTER
    delete process.env.OTEL_METRICS_EXPORTER
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    delete process.env.SDKCK_OTEL_CAPTURE_ARGV
    delete process.env.SDKCK_OTEL_CAPTURE_ERRORS
  })

  afterEach(async () => {
    await shutdownTelemetry()
    resetTelemetryForTests()
    await rm(tmpDir, {force: true, recursive: true})
  })

  const tracesFile = () => join(tmpDir, 'logs', 'otel-traces.jsonl')
  const metricsFile = () => join(tmpDir, 'logs', 'otel-metrics.jsonl')

  it('activates when initialised and reports active state', () => {
    expect(isTelemetryActive()).to.equal(false)
    initTelemetry({configDir: tmpDir, version: '1.2.3'})
    expect(isTelemetryActive()).to.equal(true)
  })

  it('does not activate when OTEL_SDK_DISABLED is set', async () => {
    process.env.OTEL_SDK_DISABLED = 'true'
    initTelemetry({configDir: tmpDir})
    expect(isTelemetryActive()).to.equal(false)

    // Callback still runs, and it returns the value untouched.
    const result = await instrumentCommand({id: 'noop'}, async () => 42)
    expect(result).to.equal(42)
  })

  it('does not activate when SDKCK_OTEL_DISABLED is set', async () => {
    process.env.SDKCK_OTEL_DISABLED = 'true'
    initTelemetry({configDir: tmpDir})
    expect(isTelemetryActive()).to.equal(false)

    // Callback still runs, and it returns the value untouched.
    const result = await instrumentCommand({id: 'noop'}, async () => 42)
    expect(result).to.equal(42)
  })

  it('records a span and metrics for a successful command', async () => {
    initTelemetry({configDir: tmpDir, version: '1.2.3'})

    const result = await instrumentCommand(
      {argv: ['--flag', 'value'], id: 'demo cmd', plugin: 'my-plugin'},
      async () => 'ok',
    )
    expect(result).to.equal('ok')

    const traces = await readLines<TraceEntry>(tracesFile())
    expect(traces).to.have.length(1)
    expect(traces[0].name).to.equal('command demo cmd')
    expect(traces[0].attributes['command.id']).to.equal('demo cmd')
    expect(traces[0].attributes['command.plugin']).to.equal('my-plugin')
    // Safe by default: only the argument count, never the raw argv.
    expect(traces[0].attributes['command.argc']).to.equal(2)
    expect(traces[0].attributes['command.argv']).to.equal(undefined)
    expect(traces[0].status.code).to.equal(1) // OK
    expect(traces[0].events).to.have.length(0)
    expect(traces[0].durationMs).to.be.a('number')

    const metrics = await readLines<MetricEntry>(metricsFile())
    const count = metrics.find((m) => m.name === 'sdkck.command.count')
    const duration = metrics.find((m) => m.name === 'sdkck.command.duration')
    expect(count, 'count metric present').to.exist
    expect(count!.attributes.status).to.equal('success')
    expect(count!.value).to.equal(1)
    expect(duration, 'duration metric present').to.exist
    expect(duration!.unit).to.equal('ms')
    expect(metrics.find((m) => m.name === 'sdkck.command.errors')).to.equal(undefined)
  })

  it('sends traces to the console (not the file) when OTEL_TRACES_EXPORTER=console, per signal', async () => {
    process.env.OTEL_TRACES_EXPORTER = 'console'
    initTelemetry({configDir: tmpDir})

    await instrumentCommand({id: 'demo'}, async () => 'ok')

    // Traces went to stdout, so no traces file is written...
    expect(await fileExists(tracesFile())).to.equal(false)
    // ...but metrics keep their default file exporter — the selection is per signal.
    expect(await fileExists(metricsFile())).to.equal(true)
  })

  it('sends metrics to the console (not the file) when OTEL_METRICS_EXPORTER=console, per signal', async () => {
    process.env.OTEL_METRICS_EXPORTER = 'console'
    initTelemetry({configDir: tmpDir})

    await instrumentCommand({id: 'demo'}, async () => 'ok')

    // Metrics went to stdout, so no metrics file is written...
    expect(await fileExists(metricsFile())).to.equal(false)
    // ...but traces keep their default file exporter.
    expect(await fileExists(tracesFile())).to.equal(true)
  })

  it('records a redacted error trace and error metric when a command throws', async () => {
    initTelemetry({configDir: tmpDir})

    const boom = new TypeError('secret-token=abc123')
    let caught: unknown
    try {
      await instrumentCommand({id: 'boom'}, async () => {
        throw boom
      })
    } catch (error) {
      caught = error
    }

    // The original error propagates untouched.
    expect(caught).to.equal(boom)

    const traces = await readLines<TraceEntry>(tracesFile())
    expect(traces).to.have.length(1)
    expect(traces[0].status.code).to.equal(2) // ERROR
    // Safe by default: the type is recorded, but not the (possibly secret) message.
    expect(traces[0].status.message).to.equal('TypeError')
    expect(traces[0].events).to.have.length(1)
    expect(traces[0].events[0].name).to.equal('exception')
    expect(traces[0].events[0].attributes['exception.type']).to.equal('TypeError')
    expect(traces[0].events[0].attributes['exception.message']).to.equal(undefined)
    // The sensitive message must not appear anywhere in the trace.
    const raw = JSON.stringify(traces[0])
    expect(raw).to.not.contain('secret-token')

    const metrics = await readLines<MetricEntry>(metricsFile())
    const errors = metrics.find((m) => m.name === 'sdkck.command.errors')
    expect(errors, 'error metric present').to.exist
    expect(errors!.attributes['command.id']).to.equal('boom')
    expect(errors!.attributes['error.type']).to.equal('TypeError')
    expect(errors!.value).to.equal(1)

    const count = metrics.find((m) => m.name === 'sdkck.command.count')
    expect(count!.attributes.status).to.equal('error')
  })

  it('captures the full argv when SDKCK_OTEL_CAPTURE_ARGV is set', async () => {
    process.env.SDKCK_OTEL_CAPTURE_ARGV = '1'
    initTelemetry({configDir: tmpDir})

    await instrumentCommand({argv: ['--flag', 'value'], id: 'demo'}, async () => 'ok')

    const traces = await readLines<TraceEntry>(tracesFile())
    expect(traces[0].attributes['command.argv']).to.equal('--flag value')
    expect(traces[0].attributes['command.argc']).to.equal(2)
  })

  it('captures the full exception message and stack when SDKCK_OTEL_CAPTURE_ERRORS is set', async () => {
    process.env.SDKCK_OTEL_CAPTURE_ERRORS = '1'
    initTelemetry({configDir: tmpDir})

    try {
      await instrumentCommand({id: 'boom'}, async () => {
        throw new TypeError('kaboom')
      })
    } catch {
      // expected
    }

    const traces = await readLines<TraceEntry>(tracesFile())
    expect(traces[0].status.message).to.equal('kaboom')
    expect(traces[0].events[0].attributes['exception.message']).to.equal('kaboom')
    expect(traces[0].events[0].attributes['exception.stacktrace']).to.be.a('string')
  })

  it('treats this.exit(0) (a clean ExitError) as a success, not an error', async () => {
    initTelemetry({configDir: tmpDir})

    // An oclif ExitError with code 0: a successful termination that surfaces
    // as a thrown error.
    const exit0 = Object.assign(new Error('EEXIT: 0'), {code: 'EEXIT', oclif: {exit: 0}})
    let caught: unknown
    try {
      await instrumentCommand({id: 'clean-exit'}, async () => {
        throw exit0
      })
    } catch (error) {
      caught = error
    }

    // The ExitError still propagates so oclif can set the process exit code.
    expect(caught).to.equal(exit0)

    const traces = await readLines<TraceEntry>(tracesFile())
    expect(traces).to.have.length(1)
    expect(traces[0].status.code).to.equal(1) // OK, not ERROR
    expect(traces[0].events).to.have.length(0) // no recorded exception

    const metrics = await readLines<MetricEntry>(metricsFile())
    expect(metrics.find((m) => m.name === 'sdkck.command.errors')).to.equal(undefined)
    const count = metrics.find((m) => m.name === 'sdkck.command.count')
    expect(count!.attributes.status).to.equal('success')
  })

  it('treats this.exit(nonzero) as an error without a recorded exception', async () => {
    initTelemetry({configDir: tmpDir})

    const exit2 = Object.assign(new Error('EEXIT: 2'), {code: 'EEXIT', oclif: {exit: 2}})
    let caught: unknown
    try {
      await instrumentCommand({id: 'failed-exit'}, async () => {
        throw exit2
      })
    } catch (error) {
      caught = error
    }

    expect(caught).to.equal(exit2)

    const traces = await readLines<TraceEntry>(tracesFile())
    expect(traces[0].status.code).to.equal(2) // ERROR
    expect(traces[0].events).to.have.length(0) // no exception event for a bare exit
    expect(traces[0].attributes['command.exit_code']).to.equal(2)

    const metrics = await readLines<MetricEntry>(metricsFile())
    const errors = metrics.find((m) => m.name === 'sdkck.command.errors')
    expect(errors, 'error metric present').to.exist
    const count = metrics.find((m) => m.name === 'sdkck.command.count')
    expect(count!.attributes.status).to.equal('error')
  })

  it('falls back to "unknown" when no command id is given', async () => {
    initTelemetry({configDir: tmpDir})
    await instrumentCommand({}, async () => {})

    const traces = await readLines<TraceEntry>(tracesFile())
    expect(traces[0].name).to.equal('command unknown')
    expect(traces[0].attributes['command.id']).to.equal('unknown')
  })

  it('runs the callback verbatim when telemetry was never initialised', async () => {
    expect(isTelemetryActive()).to.equal(false)
    const result = await instrumentCommand({id: 'demo'}, async () => 'passthrough')
    expect(result).to.equal('passthrough')
  })
})
