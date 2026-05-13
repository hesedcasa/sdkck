import {mkdirSync} from 'node:fs'
import {dirname, join} from 'node:path'
import pino from 'pino'

let logger: pino.Logger | undefined

export function initFileLogger(configDir: string): void {
  const logFile = join(configDir, 'logs', 'sdkck.log')
  mkdirSync(dirname(logFile), {recursive: true})
  logger = pino(
    {
      level: 'warn',
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        bindings: () => ({}),
        level: (label) => ({level: label}),
      },
    },
    pino.destination({dest: logFile, sync: true}),
  )
}

export function fileLog(level: 'warn' | 'error', message: string): void {
  if (!logger) return
  logger[level](message)
}
