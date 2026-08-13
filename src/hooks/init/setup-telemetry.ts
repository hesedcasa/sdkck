import {type Hook} from '@oclif/core'

import {initTelemetry, instrumentCommand} from '../../telemetry.js'

// Tag the wrapper so runCommand is wrapped exactly once per config, even if the
// init hook fires more than once in a single process.
const WRAPPED = Symbol.for('sdkck.telemetry.wrapped')

type RunCommand = ((id: string, argv?: string[], cachedCommand?: unknown) => Promise<unknown>) & {
  [WRAPPED]?: boolean
}

const hook: Hook<'init'> = async function (opts) {
  const {config} = opts
  initTelemetry({configDir: config.configDir, version: config.version})

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
