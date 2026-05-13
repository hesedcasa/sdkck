import {Command, Hook} from '@oclif/core'

import {fileLog, initFileLogger} from '../../file-logger.js'

const hook: Hook<'init'> = async function (opts) {
  initFileLogger(opts.config.configDir)

  // Tee Command.prototype.warn → log file. Cast away the overloaded types so
  // TypeScript accepts the generic wrapper signature.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalWarn = Command.prototype.warn as (this: Command, input: string | Error, options?: unknown) => string | Error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(Command.prototype as any).warn = function (input: string | Error, options?: unknown): string | Error {
    fileLog('warn', input instanceof Error ? input.message : input)
    return originalWarn.call(this, input, options)
  }

  // Tee Command.prototype.error → log file. The original always throws (never),
  // so the log entry is guaranteed to be written before the exception propagates.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalError = Command.prototype.error as (this: Command, input: string | Error, options?: unknown) => never
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(Command.prototype as any).error = function (input: string | Error, options?: unknown): never {
    fileLog('error', input instanceof Error ? input.message : input)
    return originalError.call(this, input, options)
  }

  // Wrap console.warn / console.error for non-command contexts (api-store,
  // search-cache, mcp-server, etc.) that emit directly to console.
  const origConsoleWarn = console.warn
  console.warn = (...args: unknown[]) => {
    fileLog('warn', args.map(String).join(' '))
    return origConsoleWarn.apply(console, args as Parameters<typeof console.warn>)
  }

  const origConsoleError = console.error
  console.error = (...args: unknown[]) => {
    fileLog('error', args.map(String).join(' '))
    return origConsoleError.apply(console, args as Parameters<typeof console.error>)
  }
}

export default hook
