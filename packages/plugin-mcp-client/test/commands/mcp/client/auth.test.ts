/* eslint-disable camelcase */
import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import McpClientAuth from '../../../../src/commands/mcp/client/auth.js'
import {type McpToolSchema, writeServerFile} from '../../../../src/mcp-client-store.js'
import {readOAuthState, writeOAuthState} from '../../../../src/mcp-oauth.js'

function makeAuth(configDir: string, discoverToolsStub: () => Promise<McpToolSchema[]>): McpClientAuth {
  const config = {
    bin: 'sdkck',
    configDir,
    runHook: async () => ({failures: [], successes: []}),
  } as never
  const cmd = new McpClientAuth(['my-server'], config)
  cmd.log = () => {}
  cmd._discoverTools = discoverToolsStub
  return cmd
}

describe('mcp client auth', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-client-auth-'))
  })

  afterEach(async () => {
    await rm(tmpDir, {recursive: true})
  })

  it('errors when server is not found', async () => {
    const cmd = makeAuth(tmpDir, async () => [] as McpToolSchema[])
    let thrown: Error | undefined
    try {
      await cmd.run()
    } catch (error) {
      thrown = error as Error
    }

    expect(thrown?.message).to.include('my-server')
  })

  it('errors when server uses stdio transport', async () => {
    await writeServerFile(tmpDir, {
      cachedTools: [],
      cacheTimestamp: Date.now(),
      config: {args: [], command: 'node', name: 'my-server', transport: 'stdio'},
    })
    const cmd = makeAuth(tmpDir, async () => [] as McpToolSchema[])
    let thrown: Error | undefined
    try {
      await cmd.run()
    } catch (error) {
      thrown = error as Error
    }

    expect(thrown?.message).to.include('stdio')
  })

  it('deletes the OAuth state file before re-running discoverTools', async () => {
    await writeServerFile(tmpDir, {
      cachedTools: [],
      cacheTimestamp: Date.now(),
      config: {name: 'my-server', transport: 'http', url: 'https://example.com/mcp'},
    })
    await writeOAuthState(tmpDir, 'my-server', {
      clientInfo: {client_id: 'old', redirect_uris: [], token_endpoint_auth_method: 'none'},
      tokens: {access_token: 'old-token', token_type: 'bearer'},
    })

    let oauthFileExistedDuringDiscover: boolean | undefined
    const cmd = makeAuth(tmpDir, async () => {
      oauthFileExistedDuringDiscover = (await readOAuthState(tmpDir, 'my-server')) !== null
      return [] as McpToolSchema[]
    })
    await cmd.run()

    expect(oauthFileExistedDuringDiscover).to.be.false
  })
})
