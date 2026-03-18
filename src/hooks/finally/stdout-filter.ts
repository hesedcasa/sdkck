import {Hook} from '@oclif/core'

import {deduplicate, formatDeduplicated, isStructuredOutput, smartFilter, truncateLines} from '../../filter.js'
import {stdoutBuffer} from '../stdout-buffer.js'

/**
 * Maximum output lines kept before truncation.
 * Generous enough for typical command output; prevents runaway verbosity.
 */
const MAX_LINES = 500

/**
 * finally hook: applies the complete four-strategy filter pipeline to the
 * output buffered by the init hook, then flushes it to the real stdout.
 *
 *  1. Smart Filtering  — strips template placeholders, normalises whitespace
 *  2. Grouping         — N/A for raw text streams; applied in `search` command
 *  3. Truncation       — caps total line count to MAX_LINES
 *  4. Deduplication    — collapses repeated lines across the full output
 */
const hook: Hook<'finally'> = async function () {
  const {chunks, originalWrite} = stdoutBuffer
  if (!originalWrite || chunks.length === 0) return

  // Reassemble the full command output
  let output = chunks.join('')

  // Skip all filtering for structured formats (JSON, TOML, CSV, tables)
  if (isStructuredOutput(output)) {
    originalWrite(output)
    return
  }

  // Strategy 1: Smart Filtering
  output = smartFilter(output)

  // Strategy 3: Truncation
  output = truncateLines(output, MAX_LINES)

  // Strategy 4: Deduplication
  const deduped = deduplicate(output.split('\n'))
  output = formatDeduplicated(deduped)

  originalWrite(output + '\n')
}

export default hook
