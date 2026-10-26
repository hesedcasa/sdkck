import {type Hook} from '@oclif/core'

import {isTelemetryEnvDisabled} from '../../telemetry-env.js'

// Tag the wrapper so runCommand is wrapped exactly once per config, even if the
// init hook fires more than once in a single process.
const WRAPPED = Symbol.for('sdkck.telemetry.wrapped')

type RunCommand = ((id: string, argv?: string[], cachedCommand?: unknown) => Promise<unknown>) & {
  [WRAPPED]?: boolean
}

const hook: Hook<'init'> = async function (opts) {
  const {config} = opts

  // telemetry.js statically imports the OpenTelemetry SDK (~130 modules, a
  // large share of this CLI's total module-load cost). Importing it lazily —
  // inside the wrapper, at the first command dispatch — keeps `--version`,
  // help, completions, pre-dispatch errors and every telemetry-disabled run
  // from paying for it at startup. The disabled check must also not touch
  // telemetry.js, which is why it lives in telemetry-env.js.
  if (isTelemetryEnvDisabled()) return

  // Instrument at Config.runCommand rather than Command.prototype._run. Every
  // command is dispatched through the root config's runCommand — including
  // JIT/user plugins that are installed under the data dir and resolve their
  // OWN copy of @oclif/core. Wrapping a Command prototype would only ever cover
  // one @oclif/core instance, silently leaving those plugin commands
  // un-instrumented; wrapping runCommand covers them all.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfg = config as any
  const current = cfg.runCommand as RunCommand | undefined
  if (typeof current !== 'function' || current[WRAPPED]) return

  const originalRunCommand = current.bind(config)
  const wrapper = async function (id: string, argv: string[] = [], cachedCommand: unknown = null): Promise<unknown> {
    const {initTelemetry, instrumentCommand} = await import('../../telemetry.js')
    // initTelemetry is idempotent, so calling it on every dispatch only
    // initialises the providers once.
    initTelemetry({configDir: config.configDir, version: config.version})
    // Resolve the command up front for accurate id/plugin attributes. This is a
    // plain lookup that executes nothing, and it falls back gracefully when the
    // command isn't resolvable yet (e.g. a JIT plugin's first, pre-install run).
    const cmd = cfg.findCommand?.(id) as undefined | {id?: string; pluginName?: string}
    return instrumentCommand({argv, id: cmd?.id ?? id, plugin: cmd?.pluginName}, async () =>
      originalRunCommand(id, argv, cachedCommand),
    )
  } as RunCommand
  wrapper[WRAPPED] = true
  cfg.runCommand = wrapper
}

export default hook
