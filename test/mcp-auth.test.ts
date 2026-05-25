import type {IncomingMessage, ServerResponse} from 'node:http'

import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {checkBearerToken, deleteMcpAuth, readMcpAuth, writeMcpAuth} from '../src/mcp-auth.js'

function makeReq(authorization?: string): IncomingMessage {
  return {headers: authorization ? {authorization} : {}} as unknown as IncomingMessage
}

function makeRes() {
  let statusCodeVal: null | number = null
  let endedVal = false
  let wwwAuthVal: null | string = null
  const res = {
    end() {
      endedVal = true
    },
    setHeader() {},
    writeHead(code: number, headers?: Record<string, string>) {
      statusCodeVal = code
      if (headers?.['WWW-Authenticate']) wwwAuthVal = headers['WWW-Authenticate']
      return res
    },
  } as unknown as ServerResponse
  return {
    get ended() {
      return endedVal
    },
    res,
    get statusCode() {
      return statusCodeVal
    },
    get wwwAuth() {
      return wwwAuthVal
    },
  }
}

describe('mcp-auth', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-mcp-auth-'))
  })

  afterEach(async () => {
    await rm(tmpDir, {recursive: true})
  })

  // ─── storage ────────────────────────────────────────────────────────────────

  describe('readMcpAuth', () => {
    it('returns null when file does not exist', async () => {
      expect(await readMcpAuth(tmpDir)).to.be.null
    })

    it('returns the stored token after write', async () => {
      await writeMcpAuth(tmpDir, 'abc123')
      expect(await readMcpAuth(tmpDir)).to.equal('abc123')
    })
  })

  describe('writeMcpAuth', () => {
    it('creates the file in the given directory', async () => {
      await writeMcpAuth(tmpDir, 'tok1')
      expect(await readMcpAuth(tmpDir)).to.equal('tok1')
    })

    it('overwrites an existing token', async () => {
      await writeMcpAuth(tmpDir, 'first')
      await writeMcpAuth(tmpDir, 'second')
      expect(await readMcpAuth(tmpDir)).to.equal('second')
    })
  })

  describe('deleteMcpAuth', () => {
    it('removes the token file', async () => {
      await writeMcpAuth(tmpDir, 'tok')
      await deleteMcpAuth(tmpDir)
      expect(await readMcpAuth(tmpDir)).to.be.null
    })

    it('does not throw when file does not exist', async () => {
      await deleteMcpAuth(tmpDir)
    })
  })

  // ─── checkBearerToken ───────────────────────────────────────────────────────

  describe('checkBearerToken', () => {
    it('returns true for a valid token', () => {
      const mock = makeRes()
      const result = checkBearerToken(makeReq('Bearer correcttoken'), mock.res, 'correcttoken')
      expect(result).to.be.true
      expect(mock.statusCode).to.be.null
    })

    it('returns false and writes 401 when Authorization header is missing', () => {
      const mock = makeRes()
      const result = checkBearerToken(makeReq(), mock.res, 'mytoken')
      expect(result).to.be.false
      expect(mock.statusCode).to.equal(401)
      expect(mock.wwwAuth).to.equal('Bearer')
    })

    it('returns false and writes 401 for wrong token', () => {
      const mock = makeRes()
      const result = checkBearerToken(makeReq('Bearer wrongtoken'), mock.res, 'mytoken')
      expect(result).to.be.false
      expect(mock.statusCode).to.equal(401)
    })

    it('returns false and writes 401 for malformed header (no Bearer prefix)', () => {
      const mock = makeRes()
      const result = checkBearerToken(makeReq('mytoken'), mock.res, 'mytoken')
      expect(result).to.be.false
      expect(mock.statusCode).to.equal(401)
    })
  })
})
