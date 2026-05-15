import {expect} from 'chai'

import {SENSITIVE_SEGMENTS, isSensitiveCommand} from '../src/api.js'

describe('SENSITIVE_SEGMENTS', () => {
  it('contains expected auth-related segments', () => {
    expect(SENSITIVE_SEGMENTS.has('auth')).to.be.true
    expect(SENSITIVE_SEGMENTS.has('login')).to.be.true
    expect(SENSITIVE_SEGMENTS.has('logout')).to.be.true
    expect(SENSITIVE_SEGMENTS.has('credential')).to.be.true
    expect(SENSITIVE_SEGMENTS.has('credentials')).to.be.true
    expect(SENSITIVE_SEGMENTS.has('secret')).to.be.true
    expect(SENSITIVE_SEGMENTS.has('secrets')).to.be.true
    expect(SENSITIVE_SEGMENTS.has('token')).to.be.true
    expect(SENSITIVE_SEGMENTS.has('tokens')).to.be.true
  })
})

describe('isSensitiveCommand', () => {
  it('returns true when class has static sensitive = true', () => {
    const CmdClass = class {static sensitive = true} as unknown as {sensitive?: boolean}
    expect(isSensitiveCommand('foo:bar', CmdClass)).to.be.true
  })

  it('returns false when class has static sensitive = false (escape hatch)', () => {
    const CmdClass = class {static sensitive = false} as unknown as {sensitive?: boolean}
    // id segment 'login' would normally match the pattern fallback
    expect(isSensitiveCommand('foo:login', CmdClass)).to.be.false
  })

  it('falls back to pattern match when sensitive is undefined', () => {
    const CmdClass = class {} as unknown as {sensitive?: boolean}
    expect(isSensitiveCommand('api:auth', CmdClass)).to.be.true
    expect(isSensitiveCommand('foo:login', CmdClass)).to.be.true
  })

  it('pattern match is per-segment (no substring match)', () => {
    const CmdClass = class {} as unknown as {sensitive?: boolean}
    expect(isSensitiveCommand('authority:list', CmdClass)).to.be.false
  })

  it('pattern match is case-insensitive', () => {
    const CmdClass = class {} as unknown as {sensitive?: boolean}
    expect(isSensitiveCommand('api:Auth', CmdClass)).to.be.true
  })

  it('returns false when neither flag nor pattern matches', () => {
    const CmdClass = class {} as unknown as {sensitive?: boolean}
    expect(isSensitiveCommand('api:list', CmdClass)).to.be.false
  })
})
