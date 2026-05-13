import {appendFileSync, mkdirSync} from 'node:fs'
import {dirname, join} from 'node:path'

let logFile: string | undefined
let logDirEnsured = false

export function initFileLogger(configDir: string): void {
  logFile = join(configDir, 'logs', 'sdkck.log')
  logDirEnsured = false
}

function ensureLogDir(): void {
  if (logDirEnsured || !logFile) return
  mkdirSync(dirname(logFile), {recursive: true})
  logDirEnsured = true
}

export function fileLog(level: 'warn' | 'error', message: string): void {
  if (!logFile) return
  try {
    ensureLogDir()
    appendFileSync(logFile, JSON.stringify({ts: new Date().toISOString(), level, message}) + '\n', 'utf8')
  } catch {
    // Never throw from the logger
  }
}
