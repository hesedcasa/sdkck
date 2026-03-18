/**
 * Output filtering strategies extracted from RTK.
 *
 * Four strategies applied per command type:
 * 1. Smart Filtering  – Removes noise (template syntax, excess whitespace, boilerplate)
 * 2. Grouping         – Aggregates similar items (commands by plugin/topic)
 * 3. Truncation       – Keeps relevant context, cuts redundancy
 * 4. Deduplication    – Collapses repeated lines with occurrence counts
 */

// ---------------------------------------------------------------------------
// 0. Structured-output detection
// ---------------------------------------------------------------------------

/**
 * Returns true when the output should be passed through unfiltered.
 * Detects JSON objects/arrays, TOML documents, CSV data, and oclif tables.
 */
export function isStructuredOutput(text: string): boolean {
  const trimmed = text.trimStart()

  // JSON: starts with { or [
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed)
      return true
    } catch {
      // not valid JSON — fall through
    }
  }

  // TOML: contains [section] headers or key = value pairs on the first lines
  const firstLines = trimmed.split('\n').slice(0, 10).join('\n')
  if (/^\s*\[[\w.]+\]/m.test(firstLines) || /^\s*\w[\w-]*\s*=/m.test(firstLines)) {
    return true
  }

  // CSV: first non-blank line has 2+ comma-separated fields and no template syntax
  const firstDataLine = trimmed.split('\n').find((l) => l.trim() !== '') ?? ''
  if (firstDataLine.includes(',') && firstDataLine.split(',').length >= 2 && !firstDataLine.includes(' ')) {
    return true
  }

  // oclif table: contains box-drawing characters or repeated ─ / = separators
  if (/[─━═┌┐└┘├┤┬┴┼│]/u.test(text) || /[-=]{4,}/.test(text)) {
    return true
  }

  return false
}

// ---------------------------------------------------------------------------
// 1. Smart Filtering
// ---------------------------------------------------------------------------

/** Patterns considered noise in command descriptions. */
const TEMPLATE_SYNTAX = /<%=\s*[\w.]+\s*%>/g
const EXCESS_WHITESPACE = /[ \t]{2,}/g
const TRAILING_WHITESPACE_LINE = /[ \t]+$/gm

/**
 * Removes template placeholders, normalises whitespace, and strips blank-only
 * lines from the start/end of a block.  Mirrors RTK's `MinimalFilter`.
 */
export function smartFilter(text: string, bin = ''): string {
  let out = text
  out = out.replaceAll(TEMPLATE_SYNTAX, bin)
  out = out.replaceAll(EXCESS_WHITESPACE, ' ')
  out = out.replaceAll(TRAILING_WHITESPACE_LINE, '')
  return out.trim()
}

// ---------------------------------------------------------------------------
// 2. Grouping
// ---------------------------------------------------------------------------

export interface Grouped<T> {
  items: T[]
  key: string
}

/**
 * Groups an array by a string key, preserving insertion order of first seen
 * keys.  Mirrors RTK's `by_rule` / `by_file` HashMap patterns.
 */
export function groupBy<T>(items: T[], key: (item: T) => string): Grouped<T>[] {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    const bucket = map.get(k) ?? []
    bucket.push(item)
    map.set(k, bucket)
  }

  return [...map.entries()].map(([k, v]) => ({items: v, key: k}))
}

/**
 * Returns the top-N groups sorted by descending item count.
 * Mirrors RTK's pattern of showing "top rules" / "top files".
 */
export function topGroups<T>(groups: Grouped<T>[], n: number): Grouped<T>[] {
  return [...groups].sort((a, b) => b.items.length - a.items.length).slice(0, n)
}

// ---------------------------------------------------------------------------
// 3. Truncation
// ---------------------------------------------------------------------------

/**
 * Truncates a string to `maxLen` characters, appending `…` if cut.
 * Character-safe (handles multi-byte/emoji).  Mirrors RTK's `truncate()`.
 */
export function truncate(s: string, maxLen: number): string {
  if (maxLen < 1) return '…'
  const chars = [...s]
  if (chars.length <= maxLen) return s
  if (maxLen <= 1) return '…'
  return chars.slice(0, maxLen - 1).join('') + '…'
}

/**
 * Truncates a multi-line block to `maxLines`, appending a summary comment
 * when lines are omitted.  Mirrors RTK's `smart_truncate()`.
 */
export function truncateLines(text: string, maxLines: number): string {
  const lines = text.split('\n')
  if (lines.length <= maxLines) return text
  const kept = lines.slice(0, maxLines)
  kept.push(`… ${lines.length - maxLines} more lines omitted`)
  return kept.join('\n')
}

// ---------------------------------------------------------------------------
// 4. Deduplication
// ---------------------------------------------------------------------------

export interface DeduplicatedLine {
  count: number
  line: string
}

/**
 * Normalises a log line for deduplication by replacing variable tokens
 * (timestamps, UUIDs, hex values, long numbers, file paths) with stable
 * placeholders.  Mirrors RTK's `normalize_log_line()`.
 */
export function normalizeForDedup(line: string): string {
  let out = line
  // Timestamps: 2024-01-01 10:00:00 / ISO-8601
  out = out.replaceAll(/\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}[.,]?\d*/g, '<TS>')
  // UUIDs
  out = out.replaceAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
  // Hex addresses
  out = out.replaceAll(/0x[0-9a-f]+/gi, '<HEX>')
  // Long numbers (4+ digits)
  out = out.replaceAll(/\b\d{4,}\b/g, '<NUM>')
  // File paths
  out = out.replaceAll(/\/[\w./-]+/g, '<PATH>')
  return out.trim()
}

/**
 * Collapses repeated or near-identical lines into a single entry with a count.
 * Preserves first-seen line text for display.  Mirrors RTK's dedup via HashMap.
 */
export function deduplicate(lines: string[]): DeduplicatedLine[] {
  const seen = new Map<string, DeduplicatedLine>()
  for (const line of lines) {
    const key = normalizeForDedup(line)
    const entry = seen.get(key)
    if (entry) {
      entry.count++
    } else {
      seen.set(key, {count: 1, line})
    }
  }

  return [...seen.values()]
}

/**
 * Formats deduplicated lines for display, prefixing repeated lines with `[×N]`.
 * Mirrors RTK's `[×{}]` formatting in `analyze_logs()`.
 */
export function formatDeduplicated(entries: DeduplicatedLine[]): string {
  return entries
    .filter((e) => e.line.trim() !== '')
    .map((e) => (e.count > 1 ? `[×${e.count}] ${e.line}` : e.line))
    .join('\n')
}
