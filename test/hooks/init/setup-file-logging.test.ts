import {Command} from '@oclif/core'
import {expect} from 'chai'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {fileLog, initFileLogger} from '../../../src/file-logger.js'
import hook from '../../../src/hooks/init/setup-file-logging.js'

type HookOpts = Parameters<typeof hook>[0]

function makeOpts(configDir: string): HookOpts {
  return {
    argv: [],
    config: {configDir} as unknown as HookOpts['config'],
    context: {} as HookOpts['context'],
    id: undefined,
  }
}

async function readLogEntries(logDir: string): Promise<{level: string; msg: string; time: string}[]> {
  const raw = await readFile(join(logDir, 'logs', 'sdkck.log'), 'utf8')
  return raw
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
}

describe('file logging', () => {
  describe('file-logger', () => {
    let tmpDir: string

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-file-logger-'))
      initFileLogger(tmpDir)
    })

    afterEach(async () => {
      await rm(tmpDir, {recursive: true})
    })

    it('creates the logs directory and writes a warn entry', async () => {
      fileLog('warn', 'something odd')
      const entries = await readLogEntries(tmpDir)
      expect(entries).to.have.length(1)
      expect(entries[0].level).to.equal('warn')
      expect(entries[0].msg).to.equal('something odd')
      expect(entries[0].time).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    it('writes an error entry', async () => {
      fileLog('error', 'something broke')
      const entries = await readLogEntries(tmpDir)
      expect(entries[0].level).to.equal('error')
      expect(entries[0].msg).to.equal('something broke')
    })

    it('appends multiple entries in order', async () => {
      fileLog('error', 'first')
      fileLog('warn', 'second')
      fileLog('error', 'third')
      const entries = await readLogEntries(tmpDir)
      expect(entries).to.have.length(3)
      expect(entries.map((e) => e.msg)).to.deep.equal(['first', 'second', 'third'])
    })
  })

  describe('init/setup-file-logging hook', () => {
    let tmpDir: string
    let origConsoleWarn: typeof console.warn
    let origConsoleError: typeof console.error
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let origPrototypeWarn: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let origPrototypeError: any

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-file-logging-hook-'))
      origConsoleWarn = console.warn
      origConsoleError = console.error
      origPrototypeWarn = Command.prototype.warn
      origPrototypeError = Command.prototype.error
    })

    afterEach(async () => {
      console.warn = origConsoleWarn
      console.error = origConsoleError
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(Command.prototype as any).warn = origPrototypeWarn
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(Command.prototype as any).error = origPrototypeError
      await rm(tmpDir, {recursive: true})
    })

    it('logs console.warn calls to the log file', async () => {
      await hook.call({} as never, makeOpts(tmpDir))
      console.warn('watch out')
      const entries = await readLogEntries(tmpDir)
      expect(entries).to.have.length(1)
      expect(entries[0].level).to.equal('warn')
      expect(entries[0].msg).to.equal('watch out')
    })

    it('logs console.error calls to the log file', async () => {
      await hook.call({} as never, makeOpts(tmpDir))
      console.error('something failed')
      const entries = await readLogEntries(tmpDir)
      expect(entries).to.have.length(1)
      expect(entries[0].level).to.equal('error')
      expect(entries[0].msg).to.equal('something failed')
    })

    it('still calls the original console.warn after patching', async () => {
      const captured: unknown[][] = []
      console.warn = (...args: unknown[]) => captured.push(args)
      await hook.call({} as never, makeOpts(tmpDir))
      console.warn('forwarded')
      expect(captured).to.have.length(1)
      expect(captured[0][0]).to.equal('forwarded')
    })

    it('still calls the original console.error after patching', async () => {
      const captured: unknown[][] = []
      console.error = (...args: unknown[]) => captured.push(args)
      await hook.call({} as never, makeOpts(tmpDir))
      console.error('forwarded error')
      expect(captured).to.have.length(1)
      expect(captured[0][0]).to.equal('forwarded error')
    })

    it('logs multiple console args joined by spaces', async () => {
      await hook.call({} as never, makeOpts(tmpDir))
      console.error('part1', 'part2', 'part3')
      const entries = await readLogEntries(tmpDir)
      expect(entries[0].msg).to.equal('part1 part2 part3')
    })

    it('patches Command.prototype.warn to log warnings before delegating', async () => {
      // Replace the real warn with a no-op stub so no stderr output in tests.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(Command.prototype as any).warn = (_input: Error | string) => 'stub'
      await hook.call({} as never, makeOpts(tmpDir))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(Command.prototype.warn as any).call({}, 'command warning')

      const entries = await readLogEntries(tmpDir)
      expect(entries).to.have.length(1)
      expect(entries[0].level).to.equal('warn')
      expect(entries[0].msg).to.equal('command warning')
    })

    it('patches Command.prototype.error to log errors before throwing', async () => {
      // Replace the real error with a stub that throws (matching the real behaviour).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(Command.prototype as any).error = (input: Error | string): never => {
        throw new Error(typeof input === 'string' ? input : input.message)
      }

      await hook.call({} as never, makeOpts(tmpDir))

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(Command.prototype.error as any).call({}, 'command error')
      } catch {
        // Expected — error() always throws.
      }

      const entries = await readLogEntries(tmpDir)
      expect(entries).to.have.length(1)
      expect(entries[0].level).to.equal('error')
      expect(entries[0].msg).to.equal('command error')
    })
  })
})
