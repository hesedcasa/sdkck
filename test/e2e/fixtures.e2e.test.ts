import {expect} from 'chai'

import {boardEpoch, isRunBoardName, RUN_ID, RUN_LABEL, SHARED_LABEL} from './fixtures.js'
import {redactSecrets, stripRequestLine} from './helpers.js'

/**
 * The fixture/helper machinery itself — if the oracle's naming rules or the
 * redaction/strip helpers regress, every other leg fails for the wrong
 * reason. Pure functions only; the live REST oracle round-trip is exercised
 * in the jira leg, where its credentials are guaranteed present.
 */
describe('e2e: fixtures', () => {
  it('derives the run label from the run id', () => {
    expect(RUN_LABEL).to.equal(`${SHARED_LABEL}-${RUN_ID}`)
  })

  it('recognises run board names without regexes', () => {
    const name = `[e2e-host] run ${RUN_ID} ${Date.now()}`
    expect(isRunBoardName(name, RUN_ID)).to.be.true
    // A different run's board — the exact id must not prefix-match.
    expect(isRunBoardName(name, `${RUN_ID}x`)).to.be.false
    // A board that merely starts with the prefix must never be admitted to a
    // destructive lookup.
    expect(isRunBoardName(`[e2e-host] project board`, RUN_ID)).to.be.false
    expect(isRunBoardName(``, RUN_ID)).to.be.false
  })

  it('extracts the epoch from a run board name, treating none as new', () => {
    expect(boardEpoch(`[e2e-host] run ${RUN_ID} 1750000000000`)).to.equal(1_750_000_000_000)
    // No trailing epoch: brand new, never infinitely old — the stale sweep
    // must skip it.
    expect(boardEpoch(`[e2e-host] project board`)).to.be.undefined
  })

  it('redacts every secret and skips empty needles', () => {
    const text = 'one SEKRET-A and two SEKRET-B'
    expect(redactSecrets(text, ['SEKRET-A', 'SEKRET-B'])).to.equal('one <redacted> and two <redacted>')
    // An empty needle would otherwise turn replaceAll into a full-string
    // redaction, silently scrubbing output that holds no secret at all.
    expect(redactSecrets(text, ['', undefined])).to.equal(text)
  })

  it('strips the api request line before the JSON body', () => {
    expect(stripRequestLine('POST https://api.linear.app/graphql\n{"data":1}')).to.equal('{"data":1}')
    // A body with no request line passes through untouched.
    expect(stripRequestLine('  {"data":1}')).to.equal('{"data":1}')
    expect(stripRequestLine('  [1,2]')).to.equal('[1,2]')
  })
})
