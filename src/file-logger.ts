import {mkdirSync} from 'node:fs'
import {dirname, join} from 'node:path'
import pino from 'pino'

let logger: pino.Logger | undefined

export function initFileLogger(configDir: string): void {
  const logFile = join(configDir, 'logs', 'sdkck.log')
  mkdirSync(dirname(logFile), {recursive: true})
  logger = pino(
    {
      formatters: {
        bindings: () => ({}),
        level: (label) => ({level: label}),
      },
      level: 'warn',
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.destination({dest: logFile, sync: true}),
  )
}

export function fileLog(level: 'error' | 'warn', message: string): void {
  if (!logger) return
  logger[level](message)
}
