import {expect} from 'chai'

import {isCommandAllowed, matchesPattern, type PermissionConfig} from '../src/permission-config.js'

describe('permission-config', () => {
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

  describe('isCommandAllowed', () => {
    it('allows commands when no rules exist', () => {
      const config: PermissionConfig = {rules: []}
      expect(isCommandAllowed('jira issue create', config)).to.be.true
    })

    it('disallows when first matching rule is disallow', () => {
      const config: PermissionConfig = {
        rules: [{pattern: 'jira *'}],
      }
      expect(isCommandAllowed('jira issue', config)).to.be.false
    })

    it('first match wins — ignores later rules', () => {
      const config: PermissionConfig = {
        rules: [{pattern: '*'}, {pattern: 'jira issue'}],
      }
      expect(isCommandAllowed('jira issue', config)).to.be.false
    })

    it('returns true for an unmatched command id', () => {
      const config: PermissionConfig = {
        rules: [{pattern: 'mysql *'}],
      }
      expect(isCommandAllowed('jira issue', config)).to.be.true
    })
  })
})
