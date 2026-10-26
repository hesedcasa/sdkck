import type pino from 'pino'

import {mkdirSync} from 'node:fs'
import {createRequire} from 'node:module'
import {dirname, join} from 'node:path'

let logger: pino.Logger | undefined
let logFile: string | undefined

export function initFileLogger(configDir: string): void {
  // Only record the destination here: most invocations never log a line, so
  // pino's module load, the mkdir and the destination open are all deferred to
  // the first written entry. Re-initialising points the next entry at the new
  // file, matching the eager logger this replaces.
  logFile = join(configDir, 'logs', 'sdkck.log')
  logger = undefined
}

function ensureLogger(): pino.Logger | undefined {
  if (!logFile || logger) return logger
  try {
    // Loaded through createRequire rather than a static import so pino stays
    // out of startup entirely, and synchronously so the first log call still
    // writes immediately.
    const pinoFactory = createRequire(import.meta.url)('pino') as typeof pino
    mkdirSync(dirname(logFile), {recursive: true})
    logger = pinoFactory(
      {
        formatters: {
          bindings: () => ({}),
          level: (label) => ({level: label}),
        },
        level: 'warn',
        timestamp: pinoFactory.stdTimeFunctions.isoTime,
      },
      pinoFactory.destination({dest: logFile, sync: true}),
    )
  } catch {
    // fileLog is called from error-reporting paths (Command.prototype.error,
    // the console.error wrapper), so a failed lazy init must never throw and
    // mask the error being reported. Skip this entry; the next call retries.
    return undefined
  }

  return logger
}

export function fileLog(level: 'error' | 'warn', message: string): void {
  ensureLogger()?.[level](message)
}
