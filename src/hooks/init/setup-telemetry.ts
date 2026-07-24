import {Command, Hook} from '@oclif/core'

import {initTelemetry, instrumentCommand} from '../../telemetry.js'

// Tag the wrapper so the prototype is wrapped exactly once, even if the init
// hook fires more than once in a single process.
const WRAPPED = Symbol.for('sdkck.telemetry.wrapped')

const hook: Hook<'init'> = async function (opts) {
  initTelemetry({configDir: opts.config.configDir, version: opts.config.version})

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const current = (Command.prototype as any)._run as ((this: Command) => Promise<unknown>) & {[WRAPPED]?: boolean}
  if (current[WRAPPED]) return

  // Wrap Command.prototype._run so every command invocation — including nested
  // runs triggered via config.runCommand — is traced and measured. _run has a
  // single try/catch/finally around init()/run(), so wrapping it captures both
  // successful completions and thrown errors (error traces).
  const originalRun = current
  const wrapper = function (this: Command): Promise<unknown> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctor = this.ctor as any
    return instrumentCommand({argv: this.argv, id: ctor?.id ?? this.id, plugin: ctor?.plugin?.name}, () =>
      originalRun.call(this),
    )
  } as ((this: Command) => Promise<unknown>) & {[WRAPPED]?: boolean}
  wrapper[WRAPPED] = true
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(Command.prototype as any)._run = wrapper
}

export default hook
