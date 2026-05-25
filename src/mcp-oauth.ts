/* eslint-disable camelcase */
import type {OAuthClientProvider} from '@modelcontextprotocol/sdk/client/auth.js'
import type {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type {
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'

import {spawn} from 'node:child_process'
import {mkdir, readFile, unlink, writeFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {join} from 'node:path'

import type {McpServerConfig} from './mcp-client-store.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface McpOAuthState {
  clientInfo: OAuthClientInformationFull
  expiresAt?: number // Date.now() + tokens.expires_in * 1000
  tokens: OAuthTokens
}

// ─── File helpers ─────────────────────────────────────────────────────────────

function oauthFilePath(configDir: string, serverName: string): string {
  return join(configDir, `mcp-client-${serverName}-oauth.json`)
}

export async function readOAuthState(configDir: string, serverName: string): Promise<McpOAuthState | null> {
  try {
    const raw = await readFile(oauthFilePath(configDir, serverName), 'utf8')
    return JSON.parse(raw) as McpOAuthState
  } catch {
    return null // covers ENOENT and JSON parse errors
  }
}

export async function writeOAuthState(configDir: string, serverName: string, state: McpOAuthState): Promise<void> {
  await mkdir(configDir, {recursive: true}) // no-op if already exists
  await writeFile(oauthFilePath(configDir, serverName), JSON.stringify(state, null, 2), 'utf8')
}

export async function deleteOAuthState(configDir: string, serverName: string): Promise<void> {
  try {
    await unlink(oauthFilePath(configDir, serverName))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

// ─── Static auth detection ────────────────────────────────────────────────────

export function hasStaticAuth(config: McpServerConfig): boolean {
  if (!config.headers) return false
  return Object.keys(config.headers).some((k) => k.toLowerCase() === 'authorization')
}

// ─── CliOAuthProvider ─────────────────────────────────────────────────────────

const OAUTH_REDIRECT_PORT = 9876
const TOKEN_EXPIRY_BUFFER_MS = 60_000 // refresh 60 s before expiry

export class CliOAuthProvider implements OAuthClientProvider {
  // Injectable for tests — overrides the system browser open
  _openBrowser: (url: string) => void = (url: string) => {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '', url], {detached: true, stdio: 'ignore'}).unref()
    } else {
      const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
      spawn(cmd, [url], {detached: true, stdio: 'ignore'}).unref()
    }
  }
  // Injectable for tests — overrides the 5-minute default
  _timeoutMs = 5 * 60 * 1000
  private _codeVerifier: string | undefined = undefined
  private _completedFlow = false
  private _configDir: string
  private _serverName: string
  private _transport: StreamableHTTPClientTransport | undefined = undefined

  constructor(configDir: string, serverName: string) {
    this._configDir = configDir
    this._serverName = serverName
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'sdkck-cli',
      grant_types: ['authorization_code'],
      redirect_uris: [this.redirectUrl],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
  }

  get redirectUrl(): string {
    return `http://localhost:${OAUTH_REDIRECT_PORT}/callback`
  }

  bindTransport(transport: StreamableHTTPClientTransport): void {
    this._transport = transport
  }

  async clientInformation(): Promise<OAuthClientInformationFull | undefined> {
    const state = await readOAuthState(this._configDir, this._serverName)
    return state?.clientInfo
  }

  codeVerifier(): string {
    if (this._codeVerifier === undefined) throw new Error('No code verifier saved')
    return this._codeVerifier
  }

  didCompleteFlow(): boolean {
    return this._completedFlow
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    process.stderr.write(`Opening browser to authorize sdkck...\n`)
    this._openBrowser(authorizationUrl.toString())

    const code = await this._waitForCallback()
    await this._transport!.finishAuth(code)
    this._completedFlow = true
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    await writeOAuthState(this._configDir, this._serverName, {
      clientInfo: info,
      tokens: {access_token: '', token_type: 'bearer'},
      // expiresAt intentionally omitted — new client registration clears token state
    })
  }

  saveCodeVerifier(codeVerifier: string): void {
    this._codeVerifier = codeVerifier
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const existing = await readOAuthState(this._configDir, this._serverName)
    const expiresAt = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined
    await writeOAuthState(this._configDir, this._serverName, {
      clientInfo: existing?.clientInfo ?? {client_id: '', redirect_uris: [], token_endpoint_auth_method: 'none'},
      expiresAt,
      tokens,
    })
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const state = await readOAuthState(this._configDir, this._serverName)
    if (!state?.tokens.access_token) return undefined
    if (state.expiresAt !== undefined && Date.now() >= state.expiresAt - TOKEN_EXPIRY_BUFFER_MS) {
      return undefined
    }

    return state.tokens
  }

  private _waitForCallback(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://localhost:${OAUTH_REDIRECT_PORT}`)
        const code = url.searchParams.get('code')
        server.close()
        clearTimeout(timer)

        if (code) {
          res.writeHead(200, {'Content-Type': 'text/html'})
          res.end('<h1>Authorized — you can close this tab.</h1>')
          resolve(code)
        } else {
          res.writeHead(400, {'Content-Type': 'text/html'})
          res.end('<h1>Authorization failed — you can close this tab.</h1>')
          reject(new Error('OAuth callback missing code parameter'))
        }
      })

      server.listen(OAUTH_REDIRECT_PORT, 'localhost')

      server.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer)
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${OAUTH_REDIRECT_PORT} is already in use. Free it and retry.`))
        } else {
          reject(err)
        }
      })

      const timer = setTimeout(() => {
        server.close()
        reject(new Error('OAuth flow timed out'))
      }, this._timeoutMs)
    })
  }
}
