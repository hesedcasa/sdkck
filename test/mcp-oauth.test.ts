/* eslint-disable camelcase */
import {expect, use} from 'chai'
import chaiAsPromised from 'chai-as-promised'
import {mkdtemp, rm} from 'node:fs/promises'
import {request} from 'node:http'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

use(chaiAsPromised)

import type {McpServerConfig} from '../src/mcp-client-store.js'

import {CliOAuthProvider, deleteOAuthState, hasStaticAuth, readOAuthState, writeOAuthState} from '../src/mcp-oauth.js'

describe('mcp-oauth', () => {
  describe('oauth state file helpers', () => {
    let tmpDir: string

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-oauth-'))
    })

    afterEach(async () => {
      await rm(tmpDir, {recursive: true})
    })

    describe('readOAuthState', () => {
      it('returns null when file does not exist', async () => {
        expect(await readOAuthState(tmpDir, 'myserver')).to.be.null
      })

      it('returns parsed state after a write', async () => {
        await writeOAuthState(tmpDir, 'myserver', {
          clientInfo: {client_id: 'cid', redirect_uris: [], token_endpoint_auth_method: 'none'},
          tokens: {access_token: 'tok', token_type: 'bearer'},
        })
        const state = await readOAuthState(tmpDir, 'myserver')
        expect(state?.clientInfo.client_id).to.equal('cid')
        expect(state?.tokens.access_token).to.equal('tok')
      })

      it('returns null on malformed JSON', async () => {
        const {writeFile} = await import('node:fs/promises')
        const {join: pathJoin} = await import('node:path')
        await writeFile(pathJoin(tmpDir, 'mcp-client-myserver-oauth.json'), 'bad json', 'utf8')
        expect(await readOAuthState(tmpDir, 'myserver')).to.be.null
      })
    })

    describe('writeOAuthState', () => {
      it('overwrites existing state', async () => {
        await writeOAuthState(tmpDir, 'myserver', {
          clientInfo: {client_id: 'first', redirect_uris: [], token_endpoint_auth_method: 'none'},
          tokens: {access_token: 'tok1', token_type: 'bearer'},
        })
        await writeOAuthState(tmpDir, 'myserver', {
          clientInfo: {client_id: 'second', redirect_uris: [], token_endpoint_auth_method: 'none'},
          tokens: {access_token: 'tok2', token_type: 'bearer'},
        })
        const state = await readOAuthState(tmpDir, 'myserver')
        expect(state?.clientInfo.client_id).to.equal('second')
        expect(state?.tokens.access_token).to.equal('tok2')
      })

      it('creates configDir if it does not exist', async () => {
        const nested = join(tmpDir, 'new', 'dir')
        await writeOAuthState(nested, 'myserver', {
          clientInfo: {client_id: 'cid', redirect_uris: [], token_endpoint_auth_method: 'none'},
          tokens: {access_token: 'tok', token_type: 'bearer'},
        })
        expect(await readOAuthState(nested, 'myserver')).to.not.be.null
      })
    })

    describe('deleteOAuthState', () => {
      it('removes the file', async () => {
        await writeOAuthState(tmpDir, 'myserver', {
          clientInfo: {client_id: 'cid', redirect_uris: [], token_endpoint_auth_method: 'none'},
          tokens: {access_token: 'tok', token_type: 'bearer'},
        })
        await deleteOAuthState(tmpDir, 'myserver')
        expect(await readOAuthState(tmpDir, 'myserver')).to.be.null
      })

      it('does not throw when file does not exist', async () => {
        await deleteOAuthState(tmpDir, 'myserver')
      })
    })
  })

  describe('CliOAuthProvider storage methods', () => {
    let tmpDir: string

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-oauth-provider-'))
    })

    afterEach(async () => {
      await rm(tmpDir, {recursive: true})
    })

    it('clientInformation() returns undefined when no state file exists', async () => {
      const provider = new CliOAuthProvider(tmpDir, 'srv')
      expect(await provider.clientInformation()).to.be.undefined
    })

    it('saveClientInformation() then clientInformation() round-trips', async () => {
      const provider = new CliOAuthProvider(tmpDir, 'srv')
      await provider.saveClientInformation({
        client_id: 'cid-123',
        redirect_uris: [],
        token_endpoint_auth_method: 'none',
      })
      const info = await provider.clientInformation()
      expect(info?.client_id).to.equal('cid-123')
    })

    it('tokens() returns undefined when no state file exists', async () => {
      const provider = new CliOAuthProvider(tmpDir, 'srv')
      expect(await provider.tokens()).to.be.undefined
    })

    it('saveTokens() then tokens() round-trips a non-expiring token', async () => {
      const provider = new CliOAuthProvider(tmpDir, 'srv')
      await provider.saveClientInformation({client_id: 'cid', redirect_uris: [], token_endpoint_auth_method: 'none'})
      await provider.saveTokens({access_token: 'at', token_type: 'bearer'})
      const tokens = await provider.tokens()
      expect(tokens?.access_token).to.equal('at')
    })

    it('tokens() returns undefined when access token is expired', async () => {
      const provider = new CliOAuthProvider(tmpDir, 'srv')
      await provider.saveClientInformation({client_id: 'cid', redirect_uris: [], token_endpoint_auth_method: 'none'})
      await provider.saveTokens({access_token: 'old', expires_in: 1, token_type: 'bearer'})
      // Overwrite expiresAt to be in the past
      const state = await readOAuthState(tmpDir, 'srv')
      await writeOAuthState(tmpDir, 'srv', {...state!, expiresAt: Date.now() - 1000})
      expect(await provider.tokens()).to.be.undefined
    })

    it('tokens() returns token when well within expiry', async () => {
      const provider = new CliOAuthProvider(tmpDir, 'srv')
      await provider.saveClientInformation({client_id: 'cid', redirect_uris: [], token_endpoint_auth_method: 'none'})
      // expires_in = 120s — well outside 60s buffer
      await provider.saveTokens({access_token: 'fresh', expires_in: 120, token_type: 'bearer'})
      expect((await provider.tokens())?.access_token).to.equal('fresh')
    })

    it('tokens() treats absent expires_in as non-expiring', async () => {
      const provider = new CliOAuthProvider(tmpDir, 'srv')
      await provider.saveClientInformation({client_id: 'cid', redirect_uris: [], token_endpoint_auth_method: 'none'})
      await provider.saveTokens({access_token: 'no-expiry', token_type: 'bearer'})
      expect((await provider.tokens())?.access_token).to.equal('no-expiry')
    })

    it('saveTokens() does not clobber existing clientInfo', async () => {
      const provider = new CliOAuthProvider(tmpDir, 'srv')
      await provider.saveClientInformation({
        client_id: 'cid-abc',
        redirect_uris: [],
        token_endpoint_auth_method: 'none',
      })
      await provider.saveTokens({access_token: 'at', token_type: 'bearer'})
      const info = await provider.clientInformation()
      expect(info?.client_id).to.equal('cid-abc')
    })
  })

  describe('CliOAuthProvider.redirectToAuthorization', () => {
    let tmpDir: string

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-oauth-redirect-'))
    })

    afterEach(async () => {
      await rm(tmpDir, {recursive: true})
    })

    it('calls finishAuth with the code from the callback and sets didCompleteFlow', async () => {
      const provider = new CliOAuthProvider(tmpDir, 'srv')
      await provider.saveClientInformation({client_id: 'cid', redirect_uris: [], token_endpoint_auth_method: 'none'})

      let capturedCode: string | undefined
      const fakeTransport = {
        async finishAuth(code: string) {
          capturedCode = code
          await provider.saveTokens({access_token: 'real-token', token_type: 'bearer'})
        },
      }
      provider.bindTransport(fakeTransport as never)
      provider._openBrowser = () => {} // suppress real browser open

      const authUrl = new URL('https://auth.example.com/authorize?state=abc')
      const redirectPromise = provider.redirectToAuthorization(authUrl)

      // Give the local server a moment to start, then simulate the OAuth callback
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 100)
      })
      await new Promise<void>((resolve, reject) => {
        const req = request(
          {
            hostname: 'localhost',
            path: '/callback?code=mycode123&state=abc',
            port: 9876,
          },
          (res) => {
            res.resume()
            resolve()
          },
        )
        req.on('error', reject)
        req.end()
      })

      await redirectPromise

      expect(capturedCode).to.equal('mycode123')
      expect(provider.didCompleteFlow()).to.be.true
    })

    it('times out after _timeoutMs with no callback', async () => {
      const provider = new CliOAuthProvider(tmpDir, 'srv')
      await provider.saveClientInformation({client_id: 'cid', redirect_uris: [], token_endpoint_auth_method: 'none'})
      provider.bindTransport({async finishAuth() {}} as never)
      provider._openBrowser = () => {}
      provider._timeoutMs = 200 // fast timeout for test

      const authUrl = new URL('https://auth.example.com/authorize')
      await expect(provider.redirectToAuthorization(authUrl)).to.be.rejectedWith('OAuth flow timed out')
    })
  })

  describe('hasStaticAuth', () => {
    it('returns true when headers contain Authorization key', () => {
      const config: McpServerConfig = {
        headers: {Authorization: 'Bearer tok'},
        name: 'srv',
        transport: 'http',
        url: 'https://example.com/mcp',
      }
      expect(hasStaticAuth(config)).to.be.true
    })

    it('returns true for lowercase authorization header', () => {
      const config: McpServerConfig = {
        headers: {authorization: 'Bearer tok'},
        name: 'srv',
        transport: 'http',
        url: 'https://example.com/mcp',
      }
      expect(hasStaticAuth(config)).to.be.true
    })

    it('returns false when no Authorization header', () => {
      const config: McpServerConfig = {
        headers: {'X-Custom': 'value'},
        name: 'srv',
        transport: 'http',
        url: 'https://example.com/mcp',
      }
      expect(hasStaticAuth(config)).to.be.false
    })

    it('returns false when headers is undefined', () => {
      const config: McpServerConfig = {name: 'srv', transport: 'http', url: 'https://example.com/mcp'}
      expect(hasStaticAuth(config)).to.be.false
    })

    it('returns false for stdio transport', () => {
      const config: McpServerConfig = {
        args: [],
        command: 'node',
        name: 'srv',
        transport: 'stdio',
      }
      expect(hasStaticAuth(config)).to.be.false
    })
  })
})
