import {expect} from 'chai'

import {AgentVault, ApiError, buildProxyEnv} from '../../src/agent-vault/index.js'

/** The init argument of the global fetch, without redeclaring DOM types. */
type FetchInit = NonNullable<Parameters<typeof globalThis.fetch>[1]>

const CA_PEM = '-----BEGIN CERTIFICATE-----\nstub\n-----END CERTIFICATE-----\n'

type StubCall = {
  body: unknown
  url: string
}

/** Fetch stub answering the session mint and the CA cert fetch. */
function stubFetch(options?: {caStatus?: number; mitmPort?: string}): {
  calls: StubCall[]
  fetch: typeof globalThis.fetch
} {
  const calls: StubCall[] = []

  const fetch = (async (url: string | URL, init?: FetchInit) => {
    const target = String(url)
    calls.push({body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined, url: target})

    if (target.endsWith('/v1/mitm/ca.pem')) {
      return new Response(CA_PEM, {
        headers: options?.mitmPort ? {'X-MITM-Port': options.mitmPort} : undefined,
        status: options?.caStatus ?? 200,
      })
    }

    return new Response(
      JSON.stringify({av_addr: 'http://localhost:14321', expires_at: '2026-01-01T00:00:00Z', token: 'av_ses_abc'}),
      {status: 200},
    )
  }) as unknown as typeof globalThis.fetch

  return {calls, fetch}
}

/** Fails the CA fetch `failures` times, then serves it normally. */
function flakyCaFetch(failures: number): {caCalls: number[]; fetch: typeof globalThis.fetch} {
  const caCalls: number[] = []

  const fetch = (async (url: string | URL) => {
    if (String(url).endsWith('/v1/mitm/ca.pem')) {
      caCalls.push(caCalls.length)
      if (caCalls.length <= failures) {
        return new Response(JSON.stringify({error: 'internal', message: 'temporarily broken'}), {status: 503})
      }

      return new Response(CA_PEM, {status: 200})
    }

    return new Response(
      JSON.stringify({av_addr: 'http://localhost:14321', expires_at: '2026-01-01T00:00:00Z', token: 'av_ses_abc'}),
      {status: 200},
    )
  }) as unknown as typeof globalThis.fetch

  return {caCalls, fetch}
}

describe('agent-vault sessions', () => {
  it('mints a session and derives the proxy container config', async () => {
    const {calls, fetch} = stubFetch()

    const session = await new AgentVault({address: 'http://localhost:14321', fetch, token: 'av_agt_abc'})
      .vault('my-project')
      .sessions.create({ttlSeconds: 3600})

    expect(calls.map((c) => c.url)).to.deep.equal([
      'http://localhost:14321/v1/sessions',
      'http://localhost:14321/v1/mitm/ca.pem',
    ])
    expect(calls[0].body).to.deep.equal({ttl_seconds: 3600, vault: 'my-project'})

    expect(session.token).to.equal('av_ses_abc')
    expect(session.expiresAt).to.equal('2026-01-01T00:00:00Z')
    expect(session.address).to.equal('http://localhost:14321')
    expect(session.containerConfig?.caCertificate).to.equal(CA_PEM)
    expect(session.containerConfig?.env.HTTPS_PROXY).to.equal('http://av_ses_abc:my-project@localhost:14322')
    expect(session.containerConfig?.env.HTTP_PROXY).to.equal(session.containerConfig?.env.HTTPS_PROXY)
    expect(session.containerConfig?.env.NO_PROXY).to.equal('localhost,127.0.0.1,localhost')
  })

  it('honours the port the server advertises', async () => {
    const {fetch} = stubFetch({mitmPort: '18080'})

    const session = await new AgentVault({address: 'http://vault.internal:14321', fetch, token: 'av_agt_abc'})
      .vault('my-project')
      .sessions.create()

    expect(session.containerConfig?.env.HTTPS_PROXY).to.equal('http://av_ses_abc:my-project@vault.internal:18080')
  })

  it('percent-encodes the token and vault name in the proxy URL', async () => {
    const {fetch} = stubFetch()

    const session = await new AgentVault({address: 'http://localhost:14321', fetch, token: 'av_agt_abc'})
      .vault('team/project')
      .sessions.create()

    expect(session.containerConfig?.env.HTTPS_PROXY).to.equal('http://av_ses_abc:team%2Fproject@localhost:14322')
  })

  it('returns a null container config when the server has MITM disabled', async () => {
    const {fetch} = stubFetch({caStatus: 404})

    const session = await new AgentVault({fetch, token: 'av_agt_abc'}).vault('my-project').sessions.create()

    expect(session.containerConfig).to.equal(null)
    expect(session.token).to.equal('av_ses_abc')
  })

  it('fetches the CA certificate once across repeated create() calls', async () => {
    const {calls, fetch} = stubFetch()
    const {sessions} = new AgentVault({fetch, token: 'av_agt_abc'}).vault('my-project')

    await sessions.create()
    await sessions.create()

    expect(calls.filter((c) => c.url.endsWith('/v1/mitm/ca.pem'))).to.have.length(1)
    expect(calls.filter((c) => c.url.endsWith('/v1/sessions'))).to.have.length(2)
  })

  describe('MITM metadata failures', () => {
    it('surfaces a server error instead of reporting MITM as disabled', async () => {
      const {fetch} = flakyCaFetch(Infinity)
      const {sessions} = new AgentVault({fetch, token: 'av_agt_abc'}).vault('my-project')

      const error = await sessions.create().catch((error_: unknown) => error_)

      expect(error).to.be.instanceOf(ApiError)
      expect((error as ApiError).status).to.equal(503)
    })

    it('does not cache a disabled answer, so enabling MITM later is picked up', async () => {
      let mitmEnabled = false
      const fetch = (async (url: string | URL) => {
        if (String(url).endsWith('/v1/mitm/ca.pem')) {
          return mitmEnabled ? new Response(CA_PEM, {status: 200}) : new Response('', {status: 404})
        }

        return new Response(
          JSON.stringify({av_addr: 'http://localhost:14321', expires_at: '2026-01-01T00:00:00Z', token: 'av_ses_abc'}),
          {status: 200},
        )
      }) as unknown as typeof globalThis.fetch

      const {sessions} = new AgentVault({fetch, token: 'av_agt_abc'}).vault('my-project')

      expect((await sessions.create()).containerConfig).to.equal(null)
      mitmEnabled = true
      expect((await sessions.create()).containerConfig?.caCertificate).to.equal(CA_PEM)
    })

    it('does not cache a failed metadata lookup, so a later call recovers', async () => {
      const {caCalls, fetch} = flakyCaFetch(1)
      const {sessions} = new AgentVault({fetch, token: 'av_agt_abc'}).vault('my-project')

      await sessions.create().catch(() => {})
      const session = await sessions.create()

      expect(caCalls).to.have.length(2)
      expect(session.containerConfig?.caCertificate).to.equal(CA_PEM)
    })
  })

  describe('buildProxyEnv', () => {
    const containerConfig = {
      caCertificate: CA_PEM,
      env: {
        HTTP_PROXY: 'http://token:vault@127.0.0.1:14322',
        HTTPS_PROXY: 'http://token:vault@127.0.0.1:14322',
        NO_PROXY: 'localhost,127.0.0.1',
      },
    }

    it('expands the container config with CA trust variables', () => {
      const env = buildProxyEnv(containerConfig, '/etc/ssl/agent-vault-ca.pem')

      expect(env).to.deep.equal({
        CURL_CA_BUNDLE: '/etc/ssl/agent-vault-ca.pem',
        DENO_CERT: '/etc/ssl/agent-vault-ca.pem',
        GIT_SSL_CAINFO: '/etc/ssl/agent-vault-ca.pem',
        HTTP_PROXY: 'http://token:vault@127.0.0.1:14322',
        HTTPS_PROXY: 'http://token:vault@127.0.0.1:14322',
        NO_PROXY: 'localhost,127.0.0.1',
        NODE_EXTRA_CA_CERTS: '/etc/ssl/agent-vault-ca.pem',
        NODE_USE_ENV_PROXY: '1',
        OPENCLAW_PROXY_URL: 'http://token:vault@127.0.0.1:14322',
        REQUESTS_CA_BUNDLE: '/etc/ssl/agent-vault-ca.pem',
        SSL_CERT_FILE: '/etc/ssl/agent-vault-ca.pem',
      })
    })
  })
})
