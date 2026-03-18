import {expect} from 'chai'

import {matchesPattern} from '../src/permission-config.js'

describe('matchesPattern', () => {
  it('returns true for wildcard "*"', () => {
    expect(matchesPattern('jira issue create', '*')).to.be.true
    expect(matchesPattern('mysql query', '*')).to.be.true
  })

  it('returns true for an exact match', () => {
    expect(matchesPattern('jira issue create', 'jira issue create')).to.be.true
  })

  it('returns false when pattern does not match', () => {
    expect(matchesPattern('mysql query', 'jira')).to.be.false
  })

  it('matches a bare topic pattern against sub-commands', () => {
    expect(matchesPattern('jira issue', 'jira')).to.be.true
    expect(matchesPattern('jira issue create', 'jira')).to.be.true
  })

  it('matches a bare topic pattern against the topic itself', () => {
    expect(matchesPattern('jira', 'jira')).to.be.true
  })

  it('does not match a sibling topic with a bare pattern', () => {
    expect(matchesPattern('jiraother issue', 'jira')).to.be.false
  })

  it('matches "topic *" against direct sub-commands', () => {
    expect(matchesPattern('jira issue', 'jira *')).to.be.true
    expect(matchesPattern('jira issue create', 'jira *')).to.be.true
  })

  it('matches "topic *" against the topic root', () => {
    expect(matchesPattern('jira', 'jira *')).to.be.true
  })

  it('matches nested wildcard patterns', () => {
    expect(matchesPattern('jira issue create', 'jira issue *')).to.be.true
    expect(matchesPattern('jira issue', 'jira issue *')).to.be.true
  })

  it('does not match a sibling topic with a wildcard pattern', () => {
    expect(matchesPattern('mysql query', 'jira *')).to.be.false
  })

  it('trims whitespace from patterns', () => {
    expect(matchesPattern('jira', '  jira  ')).to.be.true
  })
})
