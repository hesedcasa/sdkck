import {expect} from 'chai'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {AgentVault, AgentVaultError, ApiError, VaultClient} from '../../src/agent-vault/index.js'

interface RecordedRequest {
  body: unknown
  headers: Record<string, string>
  method: string
  url: string
}

interface StubResponse {
  body?: string
  headers?: Record<string, string>
  json?: unknown
  status?: number
}

/**
 * A fetch stub that records every call and replays queued responses. Extra
 * calls beyond the queue replay the last response.
 */
function stubFetch(responses: StubResponse[]): {calls: RecordedRequest[]; fetch: typeof globalThis.fetch} {
  const calls: RecordedRequest[] = []
  let index = 0

  const fetch = (async (url: string | URL, init?: FetchInit) => {
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[key] = value
    }

    calls.push({
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
      headers,
      method: init?.method ?? 'GET',
      url: String(url),
    })

    const stub = responses[Math.min(index, responses.length - 1)] ?? {}
    index += 1
    const body = stub.json === undefined ? (stub.body ?? '') : JSON.stringify(stub.json)

    return new Response(body, {
      headers: stub.headers,
      status: stub.status ?? 200,
    })
  }) as unknown as typeof globalThis.fetch

  return {calls, fetch}
}

/** The init argument of the global fetch, without redeclaring DOM types. */
type FetchInit = NonNullable<Parameters<typeof globalThis.fetch>[1]>

const CA_PEM = '-----BEGIN CERTIFICATE-----\nstub\n-----END CERTIFICATE-----\n'

/** Session response followed by the CA cert fetch — the order `create()` awaits them in. */
function sessionResponses(overrides?: {caStatus?: number; mitmPort?: string}): StubResponse[] {
  return [
    // eslint-disable-next-line camelcase -- wire field names
    {json: {av_addr: 'http://localhost:14321', expires_at: '2026-01-01T00:00:00Z', token: 'av_ses_abc'}},
    {
      body: CA_PEM,
      headers: overrides?.mitmPort ? {'X-MITM-Port': overrides.mitmPort} : undefined,
      status: overrides?.caStatus ?? 200,
    },
  ]
}

describe('agent-vault client', () => {
  describe('configuration', () => {
    const origToken = process.env.AGENT_VAULT_TOKEN
    const origAddr = process.env.AGENT_VAULT_ADDR

    afterEach(() => {
      if (origToken === undefined) delete process.env.AGENT_VAULT_TOKEN
      else process.env.AGENT_VAULT_TOKEN = origToken

      if (origAddr === undefined) delete process.env.AGENT_VAULT_ADDR
      else process.env.AGENT_VAULT_ADDR = origAddr
    })

    it('throws when no token is configured', () => {
      delete process.env.AGENT_VAULT_TOKEN
      expect(() => new AgentVault()).to.throw(AgentVaultError, /Token is required/)
    })

    it('falls back to AGENT_VAULT_TOKEN and AGENT_VAULT_ADDR', async () => {
      process.env.AGENT_VAULT_TOKEN = 'av_agt_env'
      process.env.AGENT_VAULT_ADDR = 'https://vault.example.com'
      const {calls, fetch} = stubFetch(sessionResponses())

      await new AgentVault({fetch}).vault('my-project').sessions.create()

      expect(calls[0].url).to.equal('https://vault.example.com/v1/sessions')
      expect(calls[0].headers.Authorization).to.equal('Bearer av_agt_env')
    })

    it('prefers explicit config over the environment', async () => {
      process.env.AGENT_VAULT_TOKEN = 'av_agt_env'
      const {calls, fetch} = stubFetch(sessionResponses())

      await new AgentVault({address: 'http://127.0.0.1:9999/', fetch, token: 'av_agt_explicit'})
        .vault('my-project')
        .sessions.create()

      // Trailing slashes are stripped from the base URL.
      expect(calls[0].url).to.equal('http://127.0.0.1:9999/v1/sessions')
      expect(calls[0].headers.Authorization).to.equal('Bearer av_agt_explicit')
    })
  })

  describe('config file fallback', () => {
    const origToken = process.env.AGENT_VAULT_TOKEN
    const origAddr = process.env.AGENT_VAULT_ADDR
    const origConfigDir = process.env.SDKCK_CONFIG_DIR
    let tmpDir: string

    beforeEach(async () => {
      delete process.env.AGENT_VAULT_TOKEN
      delete process.env.AGENT_VAULT_ADDR
      tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-agent-vault-client-'))
      process.env.SDKCK_CONFIG_DIR = tmpDir
    })

    afterEach(async () => {
      if (origToken === undefined) delete process.env.AGENT_VAULT_TOKEN
      else process.env.AGENT_VAULT_TOKEN = origToken

      if (origAddr === undefined) delete process.env.AGENT_VAULT_ADDR
      else process.env.AGENT_VAULT_ADDR = origAddr

      if (origConfigDir === undefined) delete process.env.SDKCK_CONFIG_DIR
      else process.env.SDKCK_CONFIG_DIR = origConfigDir

      await rm(tmpDir, {force: true, recursive: true})
    })

    it('falls back to token/address from <configDir>/agent-vault.json', async () => {
      await writeFile(
        join(tmpDir, 'agent-vault.json'),
        JSON.stringify({address: 'https://vault.example.com', token: 'av_agt_file'}),
        'utf8',
      )
      const {calls, fetch} = stubFetch(sessionResponses())

      await new AgentVault({fetch}).vault('my-project').sessions.create()

      expect(calls[0].url).to.equal('https://vault.example.com/v1/sessions')
      expect(calls[0].headers.Authorization).to.equal('Bearer av_agt_file')
    })

    it('prefers the environment over the file', async () => {
      process.env.AGENT_VAULT_TOKEN = 'av_agt_env'
      await writeFile(join(tmpDir, 'agent-vault.json'), JSON.stringify({token: 'av_agt_file'}), 'utf8')
      const {calls, fetch} = stubFetch(sessionResponses())

      await new AgentVault({fetch}).vault('my-project').sessions.create()

      expect(calls[0].headers.Authorization).to.equal('Bearer av_agt_env')
    })

    it('still throws when neither the environment nor the file supply a token', () => {
      expect(() => new AgentVault()).to.throw(AgentVaultError, /Token is required/)
    })

    it('throws when the file exists but is malformed', async () => {
      await writeFile(join(tmpDir, 'agent-vault.json'), '{not json', 'utf8')
      expect(() => new AgentVault()).to.throw(AgentVaultError, /Could not parse/)
    })
  })

  describe('vault scoping', () => {
    it('scopes requests to the vault with the X-Vault header', async () => {
      const {calls, fetch} = stubFetch(sessionResponses())

      await new AgentVault({fetch, token: 'av_agt_abc'}).vault('my-project').sessions.create()

      expect(calls[0].headers['X-Vault']).to.equal('my-project')
      expect(calls[0].headers['User-Agent']).to.match(/^sdkck-agent-vault-sdk\//)
    })

    it('scopes a directly constructed VaultClient', async () => {
      const {calls, fetch} = stubFetch(sessionResponses())

      const vault = new VaultClient({fetch, token: 'av_agt_abc', vault: 'direct'})
      expect(vault.name).to.equal('direct')

      await vault.sessions.create()
      expect(calls[0].headers['X-Vault']).to.equal('direct')
      expect(calls[0].body).to.deep.equal({vault: 'direct'})
    })
  })

  describe('error handling', () => {
    it('maps a JSON error envelope to ApiError', async () => {
      const {fetch} = stubFetch([{json: {error: 'vault_not_found', message: 'vault does not exist'}, status: 404}])

      try {
        await new AgentVault({fetch, token: 'av_agt_abc'}).vault('missing').sessions.create()
        expect.fail('expected ApiError')
      } catch (error) {
        expect(error).to.be.instanceOf(ApiError)
        const apiError = error as ApiError
        expect(apiError.status).to.equal(404)
        expect(apiError.code).to.equal('vault_not_found')
        expect(apiError.message).to.equal('vault does not exist')
      }
    })

    it('falls back to the status text when the error body is not JSON', async () => {
      const {fetch} = stubFetch([{body: '<html>nope</html>', status: 502}])

      const error = await new AgentVault({fetch, token: 'av_agt_abc'})
        .vault('my-project')
        .sessions.create()
        .catch((error_: unknown) => error_)

      expect(error).to.be.instanceOf(ApiError)
      expect((error as ApiError).code).to.equal('unknown')
      expect((error as ApiError).status).to.equal(502)
    })

    it('wraps network failures in AgentVaultError', async () => {
      const fetch = (async () => {
        throw new TypeError('connect ECONNREFUSED')
      }) as unknown as typeof globalThis.fetch

      const error = await new AgentVault({fetch, token: 'av_agt_abc'})
        .vault('my-project')
        .sessions.create()
        .catch((error_: unknown) => error_)

      expect(error).to.be.instanceOf(AgentVaultError)
      expect(error).to.not.be.instanceOf(ApiError)
      expect((error as AgentVaultError).message).to.match(/Network error: connect ECONNREFUSED/)
    })

    it('reports a timeout when the request outlives the timeout', async () => {
      const fetch = ((_url: string, init?: FetchInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })) as unknown as typeof globalThis.fetch

      const error = await new AgentVault({fetch, timeout: 5, token: 'av_agt_abc'})
        .vault('my-project')
        .sessions.create()
        .catch((error_: unknown) => error_)

      expect(error).to.be.instanceOf(AgentVaultError)
      expect((error as AgentVaultError).message).to.match(/Request timed out after 5ms/)
    })
  })
})
