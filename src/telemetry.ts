import {
  type Counter,
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
  type Histogram,
  type Meter,
  metrics as metricsApi,
  SpanStatusCode,
  type Tracer,
} from '@opentelemetry/api'
import {type ExportResult, ExportResultCode} from '@opentelemetry/core'
import {OTLPMetricExporter} from '@opentelemetry/exporter-metrics-otlp-http'
import {OTLPTraceExporter} from '@opentelemetry/exporter-trace-otlp-http'
import {resourceFromAttributes} from '@opentelemetry/resources'
import {
  AggregationTemporality,
  ConsoleMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics'
import {
  ConsoleSpanExporter,
  NodeTracerProvider,
  type ReadableSpan,
  SimpleSpanProcessor,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-node'
import {ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION} from '@opentelemetry/semantic-conventions'
import {appendFileSync, mkdirSync} from 'node:fs'
import {dirname, join} from 'node:path'

/**
 * OpenTelemetry instrumentation for sdkck. Every CLI command is wrapped in a
 * trace span; a counter and duration histogram are recorded per invocation and
 * failures are captured as recorded exceptions (error traces) plus an error
 * counter.
 *
 * Exporters are chosen from the environment so the CLI stays quiet and
 * network-free by default:
 *   - `OTEL_EXPORTER_OTLP_ENDPOINT` (or the signal-specific
 *     `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` / `..._METRICS_ENDPOINT`) → OTLP/HTTP.
 *   - `OTEL_TRACES_EXPORTER=console` / `OTEL_METRICS_EXPORTER=console` → stdout
 *     (per signal).
 *   - otherwise → newline-delimited JSON files under `<configDir>/logs/`.
 * Set `SDKCK_OTEL_DISABLED=true` to turn instrumentation off for sdkck only, or
 * the standard `OTEL_SDK_DISABLED=true` to turn it off entirely.
 *
 * Telemetry is safe by default: because spans can be shipped off the machine,
 * potentially secret-bearing values are NOT captured unless explicitly opted
 * in. Command arguments are reduced to an argument count (`command.argc`) and
 * failures record only the exception type. Set `SDKCK_OTEL_CAPTURE_ARGV=1` to
 * attach the full argv, and `SDKCK_OTEL_CAPTURE_ERRORS=1` to attach exception
 * messages and stack traces.
 */

const SERVICE_NAME = 'sdkck'

const METRIC_COMMAND_COUNT = 'sdkck.command.count'
const METRIC_COMMAND_DURATION = 'sdkck.command.duration'
const METRIC_COMMAND_ERRORS = 'sdkck.command.errors'

type TelemetryState = {
  // Opt-in: attach the full command arguments (may contain secrets).
  captureArgv: boolean
  // Opt-in: attach exception messages and stack traces (may contain secrets).
  captureErrors: boolean
  commandCounter: Counter
  durationHistogram: Histogram
  errorCounter: Counter
  meter: Meter
  meterProvider: MeterProvider
  tracer: Tracer
  tracerProvider: NodeTracerProvider
}

let state: TelemetryState | undefined
let isDisabled = false
// Depth of nested command runs (`config.runCommand`) so metrics are only
// force-flushed once the outermost command completes.
let activeDepth = 0

function isEnvTrue(value: string | undefined): boolean {
  return value !== undefined && ['1', 'on', 'true', 'yes'].includes(value.trim().toLowerCase())
}

function hasOtlpEndpoint(): boolean {
  return Boolean(
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
  )
}

function isTraceConsoleExporter(): boolean {
  return process.env.OTEL_TRACES_EXPORTER === 'console'
}

function isMetricConsoleExporter(): boolean {
  return process.env.OTEL_METRICS_EXPORTER === 'console'
}

/**
 * If `error` is an oclif ExitError (thrown by `this.exit(code)`), return its
 * exit code; otherwise `undefined`. A zero exit code denotes a successful
 * command completion even though it surfaces as a thrown error.
 */
function oclifExitCode(error: unknown): number | undefined {
  if (error && typeof error === 'object') {
    const e = error as {code?: unknown; oclif?: {exit?: unknown}}
    if (e.code === 'EEXIT' && typeof e.oclif?.exit === 'number') return e.oclif.exit
  }

  return undefined
}

/** SpanExporter that appends each finished span as one JSON line to a file. */
class FileSpanExporter implements SpanExporter {
  constructor(private readonly file: string) {
    mkdirSync(dirname(file), {recursive: true})
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    try {
      const lines = spans
        .map((span) => {
          const {spanId, traceId} = span.spanContext()
          return JSON.stringify({
            attributes: span.attributes,
            durationMs: span.duration[0] * 1000 + span.duration[1] / 1e6,
            events: span.events.map((e) => ({attributes: e.attributes, name: e.name})),
            name: span.name,
            spanId,
            status: span.status,
            traceId,
          })
        })
        .join('\n')
      if (lines) appendFileSync(this.file, lines + '\n')
      resultCallback({code: ExportResultCode.SUCCESS})
    } catch (error) {
      resultCallback({code: ExportResultCode.FAILED, error: error as Error})
    }
  }

  async forceFlush(): Promise<void> {
    // Writes are synchronous, so nothing is buffered.
  }

  async shutdown(): Promise<void> {
    // No resources to release.
  }
}

/** PushMetricExporter that appends each metrics batch as one JSON line to a file. */
class FileMetricExporter implements PushMetricExporter {
  constructor(private readonly file: string) {
    mkdirSync(dirname(file), {recursive: true})
  }

  export(metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void): void {
    try {
      const records: unknown[] = []
      for (const scope of metrics.scopeMetrics) {
        for (const metric of scope.metrics) {
          for (const dp of metric.dataPoints) {
            records.push({
              attributes: dp.attributes,
              name: metric.descriptor.name,
              unit: metric.descriptor.unit,
              value: dp.value,
            })
          }
        }
      }

      if (records.length > 0) {
        appendFileSync(this.file, records.map((r) => JSON.stringify(r)).join('\n') + '\n')
      }

      resultCallback({code: ExportResultCode.SUCCESS})
    } catch (error) {
      resultCallback({code: ExportResultCode.FAILED, error: error as Error})
    }
  }

  async forceFlush(): Promise<void> {
    // Writes are synchronous, so nothing is buffered.
  }

  selectAggregationTemporality(): AggregationTemporality {
    // Delta so each flush records only what happened since the last one,
    // keeping the local metrics log free of repeated cumulative snapshots.
    return AggregationTemporality.DELTA
  }

  async shutdown(): Promise<void> {
    // No resources to release.
  }
}

function buildTraceExporter(logDir: string): SpanExporter {
  if (hasOtlpEndpoint()) return new OTLPTraceExporter()
  if (isTraceConsoleExporter()) return new ConsoleSpanExporter()
  return new FileSpanExporter(join(logDir, 'otel-traces.jsonl'))
}

function buildMetricExporter(logDir: string): PushMetricExporter {
  if (hasOtlpEndpoint()) return new OTLPMetricExporter()
  if (isMetricConsoleExporter()) return new ConsoleMetricExporter()
  return new FileMetricExporter(join(logDir, 'otel-metrics.jsonl'))
}

/**
 * Initialise the tracer and meter providers. Safe to call more than once — only
 * the first call takes effect. Honours `SDKCK_OTEL_DISABLED` and `OTEL_SDK_DISABLED`.
 */
export function initTelemetry(opts: {configDir: string; version?: string}): void {
  if (state || isDisabled) return
  // `SDKCK_OTEL_DISABLED` turns telemetry off for sdkck specifically, without
  // affecting the standard `OTEL_SDK_DISABLED` that other OpenTelemetry-enabled
  // tools on the host may rely on.
  if (isEnvTrue(process.env.SDKCK_OTEL_DISABLED) || isEnvTrue(process.env.OTEL_SDK_DISABLED)) {
    isDisabled = true
    return
  }

  if (isEnvTrue(process.env.OTEL_DEBUG)) {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG)
  }

  const logDir = join(opts.configDir, 'logs')

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
    ...(opts.version && {[ATTR_SERVICE_VERSION]: opts.version}),
  })

  const tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [new SimpleSpanProcessor(buildTraceExporter(logDir))],
  })
  tracerProvider.register()

  const meterProvider = new MeterProvider({
    readers: [
      new PeriodicExportingMetricReader({
        exporter: buildMetricExporter(logDir),
        // Long interval; the CLI is short-lived so we force-flush on completion.
        exportIntervalMillis: 60_000,
      }),
    ],
    resource,
  })
  metricsApi.setGlobalMeterProvider(meterProvider)

  // Pull instruments from the provider instances (not the global API) so the
  // instrumentation keeps working even if another provider is registered
  // globally first — and so tests can re-initialise cleanly.
  const tracer = tracerProvider.getTracer(SERVICE_NAME, opts.version)
  const meter = meterProvider.getMeter(SERVICE_NAME, opts.version)

  state = {
    captureArgv: isEnvTrue(process.env.SDKCK_OTEL_CAPTURE_ARGV),
    captureErrors: isEnvTrue(process.env.SDKCK_OTEL_CAPTURE_ERRORS),
    commandCounter: meter.createCounter(METRIC_COMMAND_COUNT, {
      description: 'Number of sdkck command invocations',
    }),
    durationHistogram: meter.createHistogram(METRIC_COMMAND_DURATION, {
      description: 'Duration of sdkck command invocations',
      unit: 'ms',
    }),
    errorCounter: meter.createCounter(METRIC_COMMAND_ERRORS, {
      description: 'Number of sdkck command invocations that failed',
    }),
    meter,
    meterProvider,
    tracer,
    tracerProvider,
  }
}

/**
 * Instrument a single command execution: open a span, time it, record metrics,
 * and capture any thrown error as an error trace. When telemetry is disabled
 * the callback runs untouched.
 */
export async function instrumentCommand<T>(
  info: {argv?: string[]; id?: string; plugin?: string},
  run: () => Promise<T>,
): Promise<T> {
  if (!state) return run()

  const {captureArgv, captureErrors, commandCounter, durationHistogram, errorCounter, meterProvider, tracer} = state
  const commandId = info.id ?? 'unknown'
  const attributes: Record<string, number | string> = {'command.id': commandId}
  if (info.plugin) attributes['command.plugin'] = info.plugin
  if (info.argv && info.argv.length > 0) {
    // The raw argument vector can carry secrets (tokens, passwords, URLs with
    // embedded credentials). Record only the argument count by default; attach
    // the full argv only when the operator opts in via SDKCK_OTEL_CAPTURE_ARGV.
    attributes['command.argc'] = info.argv.length
    if (captureArgv) attributes['command.argv'] = info.argv.join(' ')
  }

  activeDepth++
  return tracer.startActiveSpan(`command ${commandId}`, {attributes}, async (span) => {
    const start = process.hrtime.bigint()
    let status = 'success'
    try {
      const result = await run()
      span.setStatus({code: SpanStatusCode.OK})
      return result
    } catch (error) {
      const exitCode = oclifExitCode(error)
      if (exitCode === 0) {
        // `this.exit(0)` throws an oclif ExitError to unwind the stack, but a
        // zero exit code is a *successful* completion — not a failure. Leave
        // the outcome as a success and let the error propagate for oclif to
        // handle.
        span.setStatus({code: SpanStatusCode.OK})
        throw error
      }

      status = 'error'
      const err = error instanceof Error ? error : new Error(String(error))
      if (exitCode === undefined) {
        // A genuine thrown exception — an error trace. The message and stack
        // can contain secrets (credentials, connection strings, response
        // bodies), so by default record only the exception type. The full
        // message and stack are attached only when the operator opts in via
        // SDKCK_OTEL_CAPTURE_ERRORS.
        if (captureErrors) {
          span.recordException(err)
        } else {
          span.addEvent('exception', {'exception.type': err.name})
        }
      } else {
        // A non-zero `this.exit(code)`: a failure, but with no useful stack.
        span.setAttribute('command.exit_code', exitCode)
      }

      // The exception type/name is safe to record; the message may not be.
      span.setStatus({code: SpanStatusCode.ERROR, message: captureErrors ? err.message : err.name})
      errorCounter.add(1, {'command.id': commandId, 'error.type': err.name})
      throw error
    } finally {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6
      const metricAttrs = {'command.id': commandId, status}
      commandCounter.add(1, metricAttrs)
      durationHistogram.record(durationMs, metricAttrs)
      span.end()
      activeDepth--
      // Once the outermost command finishes, push metrics before the
      // short-lived process exits.
      if (activeDepth === 0) {
        try {
          await meterProvider.forceFlush()
        } catch {
          // best-effort flush
        }
      }
    }
  })
}

/** Flush and shut down the providers. Best-effort; safe to call when disabled. */
// ts-prune-ignore-next
export async function shutdownTelemetry(): Promise<void> {
  if (!state) return
  const {meterProvider, tracerProvider} = state
  state = undefined
  await Promise.allSettled([tracerProvider.shutdown(), meterProvider.shutdown()])
}

/** Test helper: report whether telemetry is currently initialised. */
// ts-prune-ignore-next
export function isTelemetryActive(): boolean {
  return Boolean(state)
}

/** Test helper: reset module state so `initTelemetry` can run again. */
// ts-prune-ignore-next
export function resetTelemetryForTests(): void {
  state = undefined
  isDisabled = false
  activeDepth = 0
}
