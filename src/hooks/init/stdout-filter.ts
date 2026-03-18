import {Hook} from '@oclif/core'

import {stdoutBuffer} from '../stdout-buffer.js'

/**
 * init hook: patches process.stdout.write to buffer all output produced by any
 * command.  No filtering is applied here — the finally hook processes the
 * complete buffer once the command finishes.
 */
const hook: Hook<'init'> = async function () {
  stdoutBuffer.originalWrite = process.stdout.write.bind(process.stdout)

  type WriteChunk = string | Uint8Array
  type WriteCallback = (err?: Error | null) => void
  type WriteEncoding = string | WriteCallback

  const patched = (chunk: WriteChunk, encoding?: WriteEncoding, callback?: WriteCallback): boolean => {
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()
    const cb = typeof encoding === 'function' ? encoding : callback
    stdoutBuffer.chunks.push(text)
    cb?.()
    return true
  }

  ;(process.stdout as {write: typeof patched}).write = patched
}

export default hook
