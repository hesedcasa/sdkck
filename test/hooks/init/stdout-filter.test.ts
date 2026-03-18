import {expect} from 'chai'

import hook from '../../../src/hooks/init/stdout-filter.js'

// Each test invocation of the hook adds a process 'exit' listener (for the
// buffer flush).  Raise the limit so tests don't trigger the warning.
process.setMaxListeners(50)

type HookOpts = Parameters<typeof hook>[0]

const MOCK_OPTS: HookOpts = {argv: [], config: {} as never, context: {} as never, id: undefined} as never

type WriteChunk = string | Uint8Array
type WriteCallback = (err?: Error | null) => void
type WriteEncoding = string | WriteCallback

/**
 * Installs a mock process.stdout.write that captures written strings.
 * Must be called BEFORE the hook so the hook adopts the mock as its
 * `originalWrite` target.  Returns the captured-lines array and a
 * `restore` function that must be called in a finally block.
 */
function captureStdout(): {captured: string[]; restore: () => void} {
  const captured: string[] = []
  const saved = process.stdout.write

  ;(process.stdout as {write: unknown}).write = (
    chunk: WriteChunk,
    encoding?: WriteEncoding,
    callback?: WriteCallback,
  ): boolean => {
    captured.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
    const cb = typeof encoding === 'function' ? encoding : callback
    cb?.()
    return true
  }

  return {
    captured,
    restore() {
      process.stdout.write = saved
    },
  }
}

describe('stdout-filter hook', () => {
  it('passes normal text through unchanged', async () => {
    const {captured, restore} = captureStdout()
    try {
      await hook.call({} as never, MOCK_OPTS)
      process.stdout.write('hello world\n')
      expect(captured.join('')).to.include('hello world')
    } finally {
      restore()
    }
  })

  it('buffers partial writes and flushes on newline', async () => {
    const {captured, restore} = captureStdout()
    try {
      await hook.call({} as never, MOCK_OPTS)
      process.stdout.write('hel')
      process.stdout.write('lo\n')
      expect(captured.join('')).to.include('hello')
    } finally {
      restore()
    }
  })

  it('handles multi-line chunks', async () => {
    const {captured, restore} = captureStdout()
    try {
      await hook.call({} as never, MOCK_OPTS)
      process.stdout.write('alpha\nbeta\ngamma\n')
      const out = captured.join('')
      expect(out).to.include('alpha')
      expect(out).to.include('beta')
      expect(out).to.include('gamma')
    } finally {
      restore()
    }
  })

  describe('strategy 1 — smart filtering', () => {
    it('strips template placeholders from output lines', async () => {
      const {captured, restore} = captureStdout()
      try {
        await hook.call({} as never, MOCK_OPTS)
        process.stdout.write('<%= config.bin %> hello\n')
        expect(captured.join('')).to.not.include('<%=')
        expect(captured.join('')).to.include('hello')
      } finally {
        restore()
      }
    })

    it('leaves indentation and table spacing intact', async () => {
      const {captured, restore} = captureStdout()
      try {
        await hook.call({} as never, MOCK_OPTS)
        process.stdout.write('  col1    col2    col3\n')
        // Spaces preserved — smartFilter is NOT applied (would collapse them)
        expect(captured.join('')).to.include('  col1    col2')
      } finally {
        restore()
      }
    })
  })

  describe('strategy 3 — truncation', () => {
    it('truncates lines wider than 200 characters', async () => {
      const {captured, restore} = captureStdout()
      try {
        await hook.call({} as never, MOCK_OPTS)
        process.stdout.write('X'.repeat(250) + '\n')
        const line = captured.join('').split('\n')[0]
        expect([...line]).to.have.length.at.most(200)
      } finally {
        restore()
      }
    })

    it('leaves lines at or under 200 characters untouched', async () => {
      const {captured, restore} = captureStdout()
      try {
        await hook.call({} as never, MOCK_OPTS)
        const exactly200 = 'A'.repeat(200)
        process.stdout.write(exactly200 + '\n')
        expect(captured.join('')).to.include(exactly200)
      } finally {
        restore()
      }
    })
  })

  describe('strategy 4 — deduplication', () => {
    it('first occurrence of a line is written immediately', async () => {
      const {captured, restore} = captureStdout()
      try {
        await hook.call({} as never, MOCK_OPTS)
        process.stdout.write('error: timeout\n')
        expect(captured.join('')).to.include('error: timeout')
      } finally {
        restore()
      }
    })

    it('second identical line is suppressed until run breaks', async () => {
      const {captured, restore} = captureStdout()
      try {
        await hook.call({} as never, MOCK_OPTS)
        process.stdout.write('error: timeout\n')
        process.stdout.write('error: timeout\n')
        process.stdout.write('\n') // different (blank) line triggers flush
        const out = captured.join('')
        expect(out.match(/error: timeout/g)).to.have.length(1)
        expect(out).to.include('[×1 more]')
      } finally {
        restore()
      }
    })

    it('emits [×N more] summary proportional to repeat count', async () => {
      const {captured, restore} = captureStdout()
      try {
        await hook.call({} as never, MOCK_OPTS)
        process.stdout.write('error: fail\n')
        process.stdout.write('error: fail\n')
        process.stdout.write('error: fail\n') // 3 total → [×2 more]
        process.stdout.write('other\n')
        const out = captured.join('')
        expect(out).to.include('[×2 more]')
        expect(out).to.include('other')
      } finally {
        restore()
      }
    })

    it('resets count after a different line appears', async () => {
      const {captured, restore} = captureStdout()
      try {
        await hook.call({} as never, MOCK_OPTS)
        process.stdout.write('line-a\n')
        process.stdout.write('line-b\n') // breaks run, no summary (count=1)
        process.stdout.write('line-b\n') // duplicate
        process.stdout.write('line-c\n') // breaks run → [×1 more]
        const out = captured.join('')
        const summaries = out.match(/\[×\d+ more\]/g) ?? []
        // Only the second run (line-b×2) produces a summary
        expect(summaries).to.have.length(1)
        expect(summaries[0]).to.equal('[×1 more]')
      } finally {
        restore()
      }
    })

    it('does not deduplicate blank lines', async () => {
      const {captured, restore} = captureStdout()
      try {
        await hook.call({} as never, MOCK_OPTS)
        process.stdout.write('\n')
        process.stdout.write('\n')
        process.stdout.write('\n')
        // Three blank lines → three newlines written (blank lines pass through)
        const out = captured.join('')
        expect(out.split('\n').length - 1).to.be.gte(3)
        expect(out).to.not.include('[×')
      } finally {
        restore()
      }
    })
  })
})
