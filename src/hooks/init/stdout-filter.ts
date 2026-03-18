import {Hook} from '@oclif/core'

import {truncate} from '../../filter.js'

/**
 * Maximum line width (characters) before truncation is applied.
 * Chosen wide enough not to clip normal output but short enough to prevent
 * hard-wrapping on standard 200-column terminal sessions.
 */
const MAX_LINE_WIDTH = 200

/**
 * Strips oclif template placeholders from a line without touching
 * whitespace or indentation — preserving table / column formatting.
 * (smartFilter is not used directly because its trim() and
 * space-collapsing would break intentionally-indented output.)
 */
const TEMPLATE_SYNTAX = /<%=\s*[\w.]+\s*%>/g

/**
 * init hook: wraps process.stdout.write so every byte written to stdout by
 * any command — including JIT-installed plugin commands — is passed through
 * RTK's four output-filtering strategies before reaching the terminal.
 *
 *  1. Smart Filtering  — strips template placeholders (<%=…%>) per line
 *  2. Grouping         — N/A at the raw stream level; applied in search
 *  3. Truncation       — lines wider than MAX_LINE_WIDTH chars are cut
 *  4. Deduplication    — consecutive identical non-blank lines are suppressed;
 *                        a "[×N more]" summary is emitted when the run ends
 */
const hook: Hook<'init'> = async function () {
  // Capture the real write target before patching.
  const originalWrite = process.stdout.write.bind(process.stdout)

  let lineBuffer = '' // accumulates bytes between newlines
  let lastLine = '' // last non-blank line flushed to terminal
  let repeatCount = 0 // how many times lastLine has been seen (≥1 after first)

  /** Emit "[×N more]" when the previous line was repeated more than once. */
  function flushRepeats(): void {
    if (repeatCount > 1) {
      originalWrite(`  [×${repeatCount - 1} more]\n`)
    }
  }

  /**
   * Apply all applicable strategies to one complete line and forward to
   * originalWrite.  Returns without writing if the line is a duplicate.
   */
  function writeLine(raw: string): void {
    // Strategy 1: Smart Filtering — strip template placeholders only.
    const stripped = raw.replaceAll(TEMPLATE_SYNTAX, '')

    // Strategy 3: Truncation — avoid hard-wrapping on wide terminals.
    const display = stripped.length > MAX_LINE_WIDTH ? truncate(stripped, MAX_LINE_WIDTH) : stripped

    // Strategy 4: Deduplication — suppress non-blank consecutive identical lines.
    if (display.trim() !== '' && display === lastLine) {
      repeatCount++
      return // first occurrence already written; suppress repeat
    }

    flushRepeats() // emit count summary for previous run (if any)
    lastLine = display
    repeatCount = 1
    originalWrite(`${display}\n`)
  }

  // Patch process.stdout.write with a line-buffered filter.
  type WriteChunk = string | Uint8Array
  type WriteCallback = (err?: Error | null) => void
  type WriteEncoding = string | WriteCallback

  const patched = (chunk: WriteChunk, encoding?: WriteEncoding, callback?: WriteCallback): boolean => {
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()
    const cb = typeof encoding === 'function' ? encoding : callback

    lineBuffer += text

    // Split on newlines; keep any trailing partial line in the buffer.
    const lines = lineBuffer.split('\n')
    lineBuffer = lines.pop() ?? ''

    for (const line of lines) {
      writeLine(line)
    }

    cb?.()
    return true
  }

  ;(process.stdout as {write: typeof patched}).write = patched

  // Flush incomplete line and any pending repeat-count summary on process exit.
  process.on('exit', () => {
    if (lineBuffer) {
      writeLine(lineBuffer)
      lineBuffer = ''
    }

    flushRepeats()
  })
}

export default hook
