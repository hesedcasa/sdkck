import {expect} from 'chai'

import {
  deduplicate,
  DeduplicatedLine,
  formatDeduplicated,
  groupBy,
  normalizeForDedup,
  smartFilter,
  topGroups,
  truncate,
  truncateLines,
} from '../src/filter.js'

describe('filter', () => {
  // ---------------------------------------------------------------------------
  // 1. Smart Filtering
  // ---------------------------------------------------------------------------
  describe('smartFilter', () => {
    it('strips oclif template syntax and substitutes bin name', () => {
      const result = smartFilter('<%= config.bin %> search foo', 'sdkck')
      expect(result).to.equal('sdkck search foo')
    })

    it('strips unknown template expressions and collapses resulting whitespace', () => {
      const result = smartFilter('run <%= anything %> now')
      expect(result).to.equal('run now')
    })

    it('collapses multiple spaces into one', () => {
      expect(smartFilter('a   b   c')).to.equal('a b c')
    })

    it('trims trailing whitespace from each line', () => {
      const result = smartFilter('hello   \nworld   ')
      expect(result).to.not.match(/[ \t]$/)
    })

    it('returns empty string for blank input', () => {
      expect(smartFilter('')).to.equal('')
    })

    it('leaves normal text untouched', () => {
      expect(smartFilter('Search for available commands')).to.equal('Search for available commands')
    })
  })

  // ---------------------------------------------------------------------------
  // 2. Grouping
  // ---------------------------------------------------------------------------
  describe('groupBy', () => {
    it('groups items by key', () => {
      const items = [
        {id: 'a', plugin: 'core'},
        {id: 'b', plugin: 'extra'},
        {id: 'c', plugin: 'core'},
      ]
      const groups = groupBy(items, (i) => i.plugin)
      expect(groups).to.have.length(2)
      const core = groups.find((g) => g.key === 'core')
      expect(core?.items).to.have.length(2)
    })

    it('preserves insertion order of first seen keys', () => {
      const items = [
        {plugin: 'z', v: 1},
        {plugin: 'a', v: 2},
        {plugin: 'z', v: 3},
      ]
      const groups = groupBy(items, (i) => i.plugin)
      expect(groups[0].key).to.equal('z')
      expect(groups[1].key).to.equal('a')
    })

    it('returns empty array for empty input', () => {
      expect(groupBy([], () => 'x')).to.deep.equal([])
    })
  })

  describe('topGroups', () => {
    it('returns top N groups sorted by descending item count', () => {
      const groups = [
        {items: [1], key: 'a'},
        {items: [1, 2, 3], key: 'b'},
        {items: [1, 2], key: 'c'},
      ]
      const top2 = topGroups(groups, 2)
      expect(top2[0].key).to.equal('b')
      expect(top2[1].key).to.equal('c')
      expect(top2).to.have.length(2)
    })

    it('does not mutate the original array', () => {
      const groups = [
        {items: [1, 2], key: 'x'},
        {items: [1], key: 'y'},
      ]
      topGroups(groups, 1)
      expect(groups[0].key).to.equal('x')
    })
  })

  // ---------------------------------------------------------------------------
  // 3. Truncation
  // ---------------------------------------------------------------------------
  describe('truncate', () => {
    it('returns the string unchanged when within limit', () => {
      expect(truncate('hello', 10)).to.equal('hello')
    })

    it('appends ellipsis when exceeding limit', () => {
      expect(truncate('hello world', 8)).to.equal('hello w…')
    })

    it('handles exactly the limit', () => {
      expect(truncate('hello', 5)).to.equal('hello')
    })

    it('handles maxLen of 1', () => {
      expect(truncate('hello', 1)).to.equal('…')
    })

    it('handles empty string', () => {
      expect(truncate('', 5)).to.equal('')
    })

    it('is character-safe with multi-byte chars', () => {
      const emoji = '😀😀😀😀😀'
      const result = truncate(emoji, 3)
      expect([...result]).to.have.length(3)
    })
  })

  describe('truncateLines', () => {
    it('keeps text untouched when under limit', () => {
      const text = 'a\nb\nc'
      expect(truncateLines(text, 5)).to.equal(text)
    })

    it('appends omission comment when exceeding limit', () => {
      const text = 'a\nb\nc\nd\ne'
      const result = truncateLines(text, 3)
      expect(result).to.contain('a\nb\nc')
      expect(result).to.contain('2 more lines omitted')
    })

    it('handles single-line input', () => {
      expect(truncateLines('only', 1)).to.equal('only')
    })
  })

  // ---------------------------------------------------------------------------
  // 4. Deduplication
  // ---------------------------------------------------------------------------
  describe('normalizeForDedup', () => {
    it('replaces timestamps', () => {
      const result = normalizeForDedup('2024-01-01 10:00:00 ERROR: fail')
      expect(result).to.contain('<TS>')
      expect(result).to.not.contain('2024')
    })

    it('replaces UUIDs', () => {
      const result = normalizeForDedup('id=550e8400-e29b-41d4-a716-446655440000 failed')
      expect(result).to.contain('<UUID>')
    })

    it('replaces hex addresses', () => {
      const result = normalizeForDedup('addr=0xDEADBEEF')
      expect(result).to.contain('<HEX>')
    })

    it('replaces long numbers (4+ digits)', () => {
      const result = normalizeForDedup('port 8080 failed')
      expect(result).to.contain('<NUM>')
    })

    it('replaces file paths', () => {
      const result = normalizeForDedup('file /home/user/app.ts missing')
      expect(result).to.contain('<PATH>')
    })

    it('leaves short plain words unchanged', () => {
      const result = normalizeForDedup('ERROR: fail')
      expect(result).to.equal('ERROR: fail')
    })
  })

  describe('deduplicate', () => {
    it('collapses identical lines into a single entry', () => {
      const lines = ['ERROR: fail', 'ERROR: fail', 'ERROR: fail']
      const result = deduplicate(lines)
      expect(result).to.have.length(1)
      expect(result[0].count).to.equal(3)
      expect(result[0].line).to.equal('ERROR: fail')
    })

    it('treats timestamp-differing lines as duplicates', () => {
      const lines = ['2024-01-01 10:00:00 ERROR: timeout', '2024-01-01 10:00:01 ERROR: timeout']
      const result = deduplicate(lines)
      expect(result).to.have.length(1)
      expect(result[0].count).to.equal(2)
    })

    it('keeps distinct lines separate', () => {
      const lines = ['ERROR: auth', 'ERROR: timeout']
      const result = deduplicate(lines)
      expect(result).to.have.length(2)
    })

    it('preserves first-seen line text', () => {
      const lines = ['2024-01-01 10:00:00 ERROR: fail', '2024-01-01 10:00:01 ERROR: fail']
      const result = deduplicate(lines)
      expect(result[0].line).to.equal('2024-01-01 10:00:00 ERROR: fail')
    })

    it('returns empty array for empty input', () => {
      expect(deduplicate([])).to.deep.equal([])
    })
  })

  describe('formatDeduplicated', () => {
    it('prefixes repeated lines with [×N]', () => {
      const entries: DeduplicatedLine[] = [
        {count: 3, line: 'ERROR: fail'},
        {count: 1, line: 'WARN: slow'},
      ]
      const result = formatDeduplicated(entries)
      expect(result).to.contain('[×3] ERROR: fail')
      expect(result).to.contain('WARN: slow')
      expect(result).to.not.contain('[×1]')
    })

    it('handles empty input', () => {
      expect(formatDeduplicated([])).to.equal('')
    })
  })
})
