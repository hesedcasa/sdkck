import {expect} from 'chai'
import {mkdtempSync, rmSync} from 'node:fs'
import {readFile, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {SearchCache} from '../src/search-cache.js'

describe('SearchCache', () => {
  describe('in-memory caching', () => {
    it('returns undefined for a cache miss', () => {
      const cache = new SearchCache()
      expect(cache.get('jira issue', 5)).to.be.undefined
    })

    it('returns cached output for a cache hit', () => {
      const cache = new SearchCache()
      cache.set('jira issue', 5, 'found jira commands')
      expect(cache.get('jira issue', 5)).to.equal('found jira commands')
    })

    it('treats different queries as separate entries', () => {
      const cache = new SearchCache()
      cache.set('jira issue', 5, 'result-a')
      cache.set('confluence page', 5, 'result-b')
      expect(cache.get('jira issue', 5)).to.equal('result-a')
      expect(cache.get('confluence page', 5)).to.equal('result-b')
    })

    it('treats different limits as separate entries', () => {
      const cache = new SearchCache()
      cache.set('jira issue', 5, 'five results')
      cache.set('jira issue', 10, 'ten results')
      expect(cache.get('jira issue', 5)).to.equal('five results')
      expect(cache.get('jira issue', 10)).to.equal('ten results')
    })

    it('normalizes query whitespace and case for cache key', () => {
      const cache = new SearchCache()
      cache.set('  JIRA   Issue  ', 5, 'normalized')
      expect(cache.get('jira issue', 5)).to.equal('normalized')
    })

    it('ignores set() calls with empty output', () => {
      const cache = new SearchCache()
      cache.set('jira', 5, '')
      expect(cache.get('jira', 5)).to.be.undefined
    })
  })

  describe('TTL expiration', () => {
    it('expires entries after the TTL elapses', async () => {
      const cache = new SearchCache({ttlMs: 50})
      cache.set('jira', 5, 'old result')
      await new Promise((resolve) => { setTimeout(resolve, 80) })
      expect(cache.get('jira', 5)).to.be.undefined
    })

    it('returns fresh entries before TTL expires', () => {
      const cache = new SearchCache({ttlMs: 60_000})
      cache.set('jira', 5, 'fresh result')
      expect(cache.get('jira', 5)).to.equal('fresh result')
    })
  })

  describe('file persistence', () => {
    let tmpDir: string

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'sdkck-cache-test-'))
    })

    afterEach(() => {
      rmSync(tmpDir, {force: true, recursive: true})
    })

    it('writes cache entries to file', async () => {
      const cachePath = join(tmpDir, 'search-cache.json')
      const cache = new SearchCache({cacheFilePath: cachePath})
      cache.set('jira', 5, 'result')
      await new Promise((resolve) => { setTimeout(resolve, 50) })
      const content = await readFile(cachePath, 'utf8')
      const data = JSON.parse(content)
      expect(data.entries['jira|5']).to.exist
      expect(data.entries['jira|5'].output).to.equal('result')
    })

    it('loads existing entries from file on construction', async () => {
      const cachePath = join(tmpDir, 'search-cache.json')
      const now = Date.now()
      await writeFile(cachePath, JSON.stringify({
        entries: {
          'jira|5': {output: 'restored', timestamp: now},
        },
      }))
      const cache = new SearchCache({cacheFilePath: cachePath})
      expect(cache.get('jira', 5)).to.equal('restored')
    })

    it('ignores expired entries when loading from file', async () => {
      const cachePath = join(tmpDir, 'search-cache.json')
      const oldTimestamp = Date.now() - 100_000
      await writeFile(cachePath, JSON.stringify({
        entries: {
          'jira|5': {output: 'expired', timestamp: oldTimestamp},
        },
      }))
      const cache = new SearchCache({cacheFilePath: cachePath, ttlMs: 1000})
      expect(cache.get('jira', 5)).to.be.undefined
    })

    it('degrades gracefully when file path is unwritable', () => {
      const cache = new SearchCache({cacheFilePath: '/nonexistent/dir/cache.json'})
      cache.set('test', 5, 'result')
      expect(cache.get('test', 5)).to.equal('result')
    })

    it('degrades gracefully when file contains valid JSON with wrong structure', async () => {
      const cachePath = join(tmpDir, 'search-cache.json')
      // Valid JSON but entries is null — Object.entries(null) would throw TypeError
      await writeFile(cachePath, JSON.stringify({entries: null}))
      const cache = new SearchCache({cacheFilePath: cachePath})
      // Should start empty without throwing
      expect(cache.get('jira', 5)).to.be.undefined
    })
  })
})
