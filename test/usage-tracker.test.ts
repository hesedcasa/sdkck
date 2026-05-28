import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {applyUsageBoost, readUsageSync, recordUsage} from '../src/usage-tracker.js'

describe('usage-tracker', () => {
  describe('readUsageSync', () => {
    it('returns empty object when usage.json does not exist', () => {
      const result = readUsageSync('/nonexistent/path/that/does/not/exist')
      expect(result).to.deep.equal({})
    })

    it('returns correct data from a written usage file', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-usage-test-'))
      try {
        await recordUsage(tmpDir, 'jira:issue-get')
        await recordUsage(tmpDir, 'jira:issue-get')
        await recordUsage(tmpDir, 'petstore:listPets')
        const result = readUsageSync(tmpDir)
        expect(result['jira:issue-get'].count).to.equal(2)
        expect(result['petstore:listPets'].count).to.equal(1)
        expect(result['jira:issue-get'].lastUsed).to.be.a('number').and.greaterThan(0)
      } finally {
        await rm(tmpDir, {recursive: true})
      }
    })
  })

  describe('recordUsage', () => {
    let tmpDir: string

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-usage-test-'))
    })

    afterEach(async () => {
      await rm(tmpDir, {recursive: true})
    })

    it('creates usage.json on first invocation', async () => {
      await recordUsage(tmpDir, 'api:call')
      const result = readUsageSync(tmpDir)
      expect(result['api:call']).to.exist
      expect(result['api:call'].count).to.equal(1)
    })

    it('increments count on repeated invocations', async () => {
      await recordUsage(tmpDir, 'api:call')
      await recordUsage(tmpDir, 'api:call')
      await recordUsage(tmpDir, 'api:call')
      const result = readUsageSync(tmpDir)
      expect(result['api:call'].count).to.equal(3)
    })

    it('tracks multiple commands independently', async () => {
      await recordUsage(tmpDir, 'jira:issue-get')
      await recordUsage(tmpDir, 'petstore:listPets')
      await recordUsage(tmpDir, 'jira:issue-get')
      const result = readUsageSync(tmpDir)
      expect(result['jira:issue-get'].count).to.equal(2)
      expect(result['petstore:listPets'].count).to.equal(1)
    })

    it('updates lastUsed timestamp on each invocation', async () => {
      await recordUsage(tmpDir, 'api:call')
      const first = readUsageSync(tmpDir)['api:call'].lastUsed
      await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
      await recordUsage(tmpDir, 'api:call')
      const second = readUsageSync(tmpDir)['api:call'].lastUsed
      expect(second).to.be.greaterThan(first)
    })

    it('does nothing when configDir is empty string', async () => {
      // Should not throw
      await recordUsage('', 'api:call')
    })
  })

  describe('applyUsageBoost', () => {
    it('returns the same order when usage map is empty', () => {
      const ranked = ['a', 'b', 'c']
      expect(applyUsageBoost(ranked, {})).to.deep.equal(['a', 'b', 'c'])
    })

    it('returns the same order when no ranked command has usage data', () => {
      const ranked = ['a', 'b', 'c']
      const usage = {'x:other': {count: 100, lastUsed: Date.now()}}
      expect(applyUsageBoost(ranked, usage)).to.deep.equal(['a', 'b', 'c'])
    })

    it('boosts a frequently-used command above an unused one', () => {
      // 'b' at position 1, used 50 times → score = 1 - ln(51)*0.5 ≈ 1 - 1.96 = -0.96
      // 'a' at position 0, never used → score = 0
      // So 'b' should jump to position 0
      const ranked = ['a', 'b']
      const usage = {'b': {count: 50, lastUsed: Date.now()}}
      const result = applyUsageBoost(ranked, usage)
      expect(result[0]).to.equal('b')
      expect(result[1]).to.equal('a')
    })

    it('does not boost a lightly-used command past an unused one at position 0', () => {
      // 'b' at position 1, used 3 times → score = 1 - ln(4)*0.5 ≈ 1 - 0.69 = 0.31
      // 'a' at position 0, never used → score = 0
      // 0.31 > 0, so 'a' stays first
      const ranked = ['a', 'b']
      const usage = {'b': {count: 3, lastUsed: Date.now()}}
      const result = applyUsageBoost(ranked, usage)
      expect(result[0]).to.equal('a')
    })

    it('preserves relative order of commands with equal adjusted scores', () => {
      const now = Date.now()
      const ranked = ['a', 'b', 'c']
      // All unused → all scores are 0, 1, 2 → original order
      const usage = {'z': {count: 1, lastUsed: now}}
      expect(applyUsageBoost(ranked, usage)).to.deep.equal(['a', 'b', 'c'])
    })

    it('handles a single command list', () => {
      const ranked = ['only']
      const usage = {'only': {count: 100, lastUsed: Date.now()}}
      expect(applyUsageBoost(ranked, usage)).to.deep.equal(['only'])
    })
  })
})
