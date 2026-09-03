import {expect} from 'chai'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {AgentProxy, AgentProxyApiError, AgentProxyError} from '../../src/agent-proxy/index.js'

const CA_PEM = '-----BEGIN CERTIFICATE-----\nstub\n-----END CERTIFICATE-----\n'

/** A stub Infisical control plane that records the calls made to it. */
type StubFetch = typeof globalThis.fetch & {calls: string[]}

function stubFetch(options?: {body?: unknown; status?: number}): StubFetch {
  const calls: string[] = []

  const fn = (async (url: string | URL) => {
    calls.push(String(url))
    return new Response(JSON.stringify(options?.body ?? {accessToken: 'st.abc.def', expiresIn: 2592}), {
      status: options?.status ?? 200,
    })
  }) as unknown as StubFetch

  fn.calls = calls
  return fn
}

describe('AgentProxy', () => {
  let tmpDir: string
  let caPath: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-agent-proxy-test-'))
    caPath = join(tmpDir, 'mitm-ca.pem')
    await writeFile(caPath, CA_PEM)
  })

  afterEach(async () => {
    await rm(tmpDir, {force: true, recursive: true})
  })

  describe('intercept', () => {
    it('routes traffic through the proxy with the supplied token', async () => {
      const env: NodeJS.ProcessEnv = {}
      const proxy = new AgentProxy({
        address: 'proxy-host:17322',
        caPath,
        envSource: {SDKCK_CONFIG_DIR: tmpDir},
        token: 'st.supplied',
      })

      const result = await proxy.intercept({certPath: join(tmpDir, 'ca.pem'), env})

      expect(result.env.HTTPS_PROXY).to.equal('http://st.supplied@proxy-host:17322')
      expect(result.env.HTTP_PROXY).to.equal(result.env.HTTPS_PROXY)
      expect(result.env.NODE_USE_ENV_PROXY).to.equal('1')
      expect(result.env.NODE_EXTRA_CA_CERTS).to.equal(result.certPath)
      expect(result.env.SSL_CERT_FILE).to.equal(result.certPath)
      expect(result.env.NO_PROXY).to.equal('localhost,127.0.0.1,proxy-host')
      // A supplied token's expiry is not something this client can know.
      expect(result.expiresIn).to.equal(null)
      expect(env.HTTPS_PROXY).to.equal(result.env.HTTPS_PROXY)
    })

    it('logs in with Universal Auth when no token is supplied', async () => {
      const fetch = stubFetch()
      const proxy = new AgentProxy({
        address: 'proxy-host',
        caPath,
        clientId: 'client-id',
        clientSecret: 'client-secret',
        domain: 'https://eu.infisical.com',
        envSource: {SDKCK_CONFIG_DIR: tmpDir},
        fetch,
      })

      const result = await proxy.intercept({certPath: join(tmpDir, 'ca.pem'), env: {}})

      expect(fetch.calls).to.deep.equal(['https://eu.infisical.com/api/v1/auth/universal-auth/login'])
      // No port in the address, so the documented default is filled in.
      expect(result.env.HTTPS_PROXY).to.equal('http://st.abc.def@proxy-host:17322')
      expect(result.expiresIn).to.equal(2592)
    })

    it('writes the root CA where the CA trust variables point', async () => {
      const certPath = join(tmpDir, 'nested', 'ca.pem')
      const proxy = new AgentProxy({
        address: 'proxy-host:17322',
        caPath,
        envSource: {SDKCK_CONFIG_DIR: tmpDir},
        token: 'st.abc',
      })

      const result = await proxy.intercept({certPath, env: {}})

      const {readFile} = await import('node:fs/promises')
      expect(await readFile(result.certPath, 'utf8')).to.equal(CA_PEM)
    })

    it('merges extra bypass hosts into NO_PROXY', async () => {
      const proxy = new AgentProxy({
        address: 'proxy-host:17322',
        caPath,
        envSource: {SDKCK_CONFIG_DIR: tmpDir},
        token: 'st.abc',
      })

      const result = await proxy.intercept({
        certPath: join(tmpDir, 'ca.pem'),
        env: {},
        noProxy: 'jenkins.internal, 10.0.0.5',
      })

      expect(result.env.NO_PROXY).to.equal('localhost,127.0.0.1,proxy-host,jenkins.internal,10.0.0.5')
    })

    it('resolves configuration from the environment', async () => {
      const proxy = new AgentProxy({
        envSource: {
          INFISICAL_AGENT_PROXY_ADDRESS: 'env-host:9999',
          INFISICAL_AGENT_PROXY_CA: caPath,
          INFISICAL_TOKEN: 'st.from-env',
          SDKCK_CONFIG_DIR: tmpDir,
        },
      })

      const result = await proxy.intercept({certPath: join(tmpDir, 'ca.pem'), env: {}})

      expect(result.env.HTTPS_PROXY).to.equal('http://st.from-env@env-host:9999')
    })

    it('percent-encodes a token that is not URL-safe', async () => {
      const proxy = new AgentProxy({
        address: 'proxy-host:17322',
        caPath,
        envSource: {SDKCK_CONFIG_DIR: tmpDir},
        token: 'st.a/b:c@d',
      })

      const result = await proxy.intercept({certPath: join(tmpDir, 'ca.pem'), env: {}})

      expect(result.env.HTTPS_PROXY).to.equal('http://st.a%2Fb%3Ac%40d@proxy-host:17322')
    })
  })

  describe('failures', () => {
    it('throws when no address is configured', async () => {
      const proxy = new AgentProxy({caPath, envSource: {SDKCK_CONFIG_DIR: tmpDir}, token: 'st.abc'})

      const error = await proxy.intercept({env: {}}).catch((error_: unknown) => error_)

      expect(error).to.be.instanceOf(AgentProxyError)
      expect((error as Error).message).to.match(/address is required/)
    })

    it('throws when no credential is configured', async () => {
      const proxy = new AgentProxy({address: 'proxy-host:17322', caPath, envSource: {SDKCK_CONFIG_DIR: tmpDir}})

      const error = await proxy.intercept({env: {}}).catch((error_: unknown) => error_)

      expect(error).to.be.instanceOf(AgentProxyError)
      expect((error as Error).message).to.match(/agent credential is required/)
    })

    it('reports a missing root CA with the command that writes it', async () => {
      const proxy = new AgentProxy({
        address: 'proxy-host:17322',
        caPath: join(tmpDir, 'absent.pem'),
        envSource: {SDKCK_CONFIG_DIR: tmpDir},
        token: 'st.abc',
      })

      const error = await proxy.intercept({env: {}}).catch((error_: unknown) => error_)

      expect(error).to.be.instanceOf(AgentProxyError)
      expect((error as Error).message).to.match(/agent-proxy connect/)
    })

    it('rejects a CA file that is not a PEM certificate', async () => {
      const junk = join(tmpDir, 'junk.pem')
      await writeFile(junk, 'not a certificate')
      const proxy = new AgentProxy({
        address: 'proxy-host:17322',
        caPath: junk,
        envSource: {SDKCK_CONFIG_DIR: tmpDir},
        token: 'st.abc',
      })

      const error = await proxy.intercept({env: {}}).catch((error_: unknown) => error_)

      expect((error as Error).message).to.match(/not a PEM certificate/)
    })

    it('surfaces a rejected machine identity as an AgentProxyApiError', async () => {
      const proxy = new AgentProxy({
        address: 'proxy-host:17322',
        caPath,
        clientId: 'client-id',
        clientSecret: 'wrong',
        envSource: {SDKCK_CONFIG_DIR: tmpDir},
        fetch: stubFetch({body: {message: 'Unauthorized'}, status: 401}),
      })

      const error = await proxy.intercept({env: {}}).catch((error_: unknown) => error_)

      expect(error).to.be.instanceOf(AgentProxyApiError)
      expect((error as AgentProxyApiError).status).to.equal(401)
      expect((error as Error).message).to.match(/Universal Auth login failed with HTTP 401: Unauthorized/)
    })

    it('throws when login succeeds but returns no token', async () => {
      const proxy = new AgentProxy({
        address: 'proxy-host:17322',
        caPath,
        clientId: 'client-id',
        clientSecret: 'client-secret',
        envSource: {SDKCK_CONFIG_DIR: tmpDir},
        fetch: stubFetch({body: {expiresIn: 60}}),
      })

      const error = await proxy.intercept({env: {}}).catch((error_: unknown) => error_)

      expect((error as Error).message).to.match(/returned no access token/)
    })
  })
})
