import {expect} from 'chai'
import {Buffer} from 'node:buffer'
import {createHash} from 'node:crypto'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {createServer, type Server} from 'node:http'
import {type AddressInfo} from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {AgentVaultError, ApiError} from '../../src/agent-vault/errors.js'
import {
  buildPlatformContainerConfig,
  certificateFingerprint,
  fetchProxyCa,
  normalizeFingerprint,
  normalizeProxyAddress,
  PlatformProxy,
} from '../../src/agent-vault/index.js'

const CA_PEM = '-----BEGIN CERTIFICATE-----\nstub\n-----END CERTIFICATE-----\n'

/** Start a stub platform proxy; its CA endpoint answers with `body` and `status`. */
async function startCaStub(options?: {body?: string; hang?: boolean; status?: number;}): Promise<{server: Server; url: URL}> {
  const server = createServer((_request, response) => {
    if (options?.hang) return // never respond — the client must time out

    response.writeHead(options?.status ?? 200, {'Content-Type': 'application/json'})
    response.end(options?.body ?? JSON.stringify({certificate: CA_PEM}))
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const {port} = server.address() as AddressInfo
  return {server, url: new URL(`http://127.0.0.1:${port}`)}
}

function stopStub(server: Server): Promise<void> {
  server.closeAllConnections()
  return new Promise((resolve) => {
    server.close(() => resolve())
  })
}

describe('agent-vault platform primitives', () => {
  describe('normalizeProxyAddress', () => {
    it('defaults the scheme to http for bare host:port input', () => {
      const url = normalizeProxyAddress('proxy.internal:17323')
      expect(url.protocol).to.equal('http:')
      expect(url.hostname).to.equal('proxy.internal')
      expect(url.port).to.equal('17323')
    })

    it('keeps an explicit scheme and trims whitespace', () => {
      expect(normalizeProxyAddress('  https://proxy.internal  ').protocol).to.equal('https:')
    })

    it('throws on garbage, empty hosts, and non-http schemes', () => {
      expect(() => normalizeProxyAddress('not a url!!')).to.throw(AgentVaultError)
      expect(() => normalizeProxyAddress('http://')).to.throw(AgentVaultError, /host is missing/)
      expect(() => normalizeProxyAddress('ftp://proxy.internal:17323')).to.throw(AgentVaultError, /http and https/)
    })
  })

  describe('fetchProxyCa', () => {
    let stub: undefined | {server: Server; url: URL}

    afterEach(async () => {
      if (stub) await stopStub(stub.server)
      stub = undefined
    })

    it('fetches the certificate from /_agent-vault/ca', async () => {
      stub = await startCaStub()

      const ca = await fetchProxyCa(stub.url)
      expect(ca).to.equal(CA_PEM)
    })

    it('maps a non-2xx answer to an ApiError carrying the status', async () => {
      stub = await startCaStub({body: 'nope', status: 404})

      const error = await fetchProxyCa(stub.url).catch((error_: unknown) => error_)
      expect(error).to.be.instanceOf(ApiError)
      expect((error as ApiError).status).to.equal(404)
    })

    it('rejects a body that is not valid JSON', async () => {
      stub = await startCaStub({body: '<html>gateway error</html>'})

      const error = await fetchProxyCa(stub.url).catch((error_: unknown) => error_)
      expect(error).to.be.instanceOf(AgentVaultError)
      expect((error as Error).message).to.match(/valid JSON/)
    })

    it('rejects an envelope without a string certificate field', async () => {
      stub = await startCaStub({body: JSON.stringify({certificate: 42})})

      const error = await fetchProxyCa(stub.url).catch((error_: unknown) => error_)
      expect(error).to.be.instanceOf(AgentVaultError)
      expect((error as Error).message).to.match(/"certificate"/)
    })

    it('times out when the proxy never answers', async () => {
      stub = await startCaStub({hang: true})

      const error = await fetchProxyCa(stub.url, 50).catch((error_: unknown) => error_)
      expect(error).to.be.instanceOf(AgentVaultError)
      expect((error as Error).message).to.match(/timed out after 50ms/)
    })

    it('rejects with a network error when nothing listens on the port', async () => {
      const dead = await startCaStub()
      await stopStub(dead.server)

      const error = await fetchProxyCa(dead.url, 2000).catch((error_: unknown) => error_)
      expect(error).to.be.instanceOf(AgentVaultError)
      expect((error as Error).message).to.match(/Network error/)
    })
  })

  describe('certificate fingerprints', () => {
    it('hashes the PEM body to an uppercase-hex SHA-256 of the DER', () => {
      const der = Buffer.from('stub'.replaceAll(/\s+/g, ''), 'base64')
      const expected = createHash('sha256').update(der).digest('hex').toUpperCase()

      expect(certificateFingerprint(CA_PEM)).to.equal(expected)
    })

    it('rejects non-PEM input', () => {
      expect(() => certificateFingerprint('definitely not a certificate')).to.throw(AgentVaultError)
    })

    it('normalizes the optional sha256 prefix and case away', () => {
      expect(normalizeFingerprint('sha256:ab cd')).to.equal('ABCD')
      expect(normalizeFingerprint('ABCD')).to.equal('ABCD')
    })
  })

  describe('PlatformProxy', () => {
    let tmpDir: string
    let stub: {server: Server; url: URL}

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-platform-proxy-'))
      stub = await startCaStub()
    })

    afterEach(async () => {
      await stopStub(stub.server)
      await rm(tmpDir, {force: true, recursive: true})
    })

    it('applies the platform proxy env to the passed object without touching process.env', async () => {
      const target: NodeJS.ProcessEnv = {}
      const before = {...process.env}

      const result = await new PlatformProxy({proxy: stub.url.origin, sessionToken: 'agv_tok'}).intercept({
        certPath: join(tmpDir, 'ca.pem'),
        env: target,
      })

      expect(result.mode).to.equal('platform')
      expect(result.env.HTTPS_PROXY).to.equal(`http://x-agent-vault:agv_tok@127.0.0.1:${stub.url.port}`)
      expect(result.env.HTTP_PROXY).to.equal(result.env.HTTPS_PROXY)
      expect(result.env.NODE_USE_ENV_PROXY).to.equal('1')
      expect(result.env.NO_PROXY).to.equal('localhost,127.0.0.1,127.0.0.1')
      expect(result.env.NODE_EXTRA_CA_CERTS).to.equal(join(tmpDir, 'ca.pem'))
      // `assembleInterceptedEnv` returns a snapshot object and copies the same
      // properties into the caller's `env` — contents match, identity does not.
      expect(target).to.deep.equal(result.env)
      expect(process.env).to.deep.equal(before)
    })

    it('percent-encodes the session token in the proxy userinfo', async () => {
      const result = await new PlatformProxy({proxy: stub.url.origin, sessionToken: 'agv_a b/c'}).intercept({
        certPath: join(tmpDir, 'ca.pem'),
        env: {},
      })

      expect(result.env.HTTPS_PROXY).to.contain('x-agent-vault:agv_a%20b%2Fc@')
    })

    it('writes the fetched CA to the requested path', async () => {
      const result = await new PlatformProxy({proxy: stub.url.origin, sessionToken: 'agv_tok'}).intercept({
        certPath: join(tmpDir, 'ca.pem'),
        env: {},
      })

      expect(await readFile(result.certPath, 'utf8')).to.equal(CA_PEM)
      expect(result.containerConfig.caCertificate).to.equal(CA_PEM)
    })

    it('merges the noProxy option and inherited bypasses into NO_PROXY', async () => {
      const result = await new PlatformProxy({proxy: stub.url.origin, sessionToken: 'agv_tok'}).intercept({
        certPath: join(tmpDir, 'ca.pem'),
        env: {NO_PROXY: 'parent.internal', no_proxy: 'lower.internal'} as NodeJS.ProcessEnv,
        noProxy: 'config.internal',
      })

      expect(result.env.NO_PROXY).to.equal(
        'localhost,127.0.0.1,127.0.0.1,parent.internal,lower.internal,config.internal',
      )
    })

    it('accepts a matching CA fingerprint pin in any spelling', async () => {
      const pin = `sha256:${certificateFingerprint(CA_PEM).toLowerCase()}`

      const result = await new PlatformProxy({
        caFingerprint: pin,
        proxy: stub.url.origin,
        sessionToken: 'agv_tok',
      }).intercept({certPath: join(tmpDir, 'ca.pem'), env: {}})

      expect(result.mode).to.equal('platform')
    })

    it('resolves with an empty CA fingerprint, which means no pin rather than a degenerate check', async () => {
      const result = await new PlatformProxy({caFingerprint: '', proxy: stub.url.origin, sessionToken: 'agv_tok'})
        .intercept({certPath: join(tmpDir, 'ca.pem'), env: {}})

      expect(result.mode).to.equal('platform')
    })

    it('fails closed on a fingerprint mismatch, before any env is applied', async () => {
      const target: NodeJS.ProcessEnv = {}
      const certPath = join(tmpDir, 'never-written.pem')

      const error = await new PlatformProxy({
        caFingerprint: 'sha256:deadbeef',
        proxy: stub.url.origin,
        sessionToken: 'agv_tok',
      })
        .intercept({certPath, env: target})
        .catch((error_: unknown) => error_)

      expect(error).to.be.instanceOf(AgentVaultError)
      expect((error as Error).message).to.match(/fingerprint/i)
      expect(target).to.deep.equal({})
    })

    it('exposes the parsed proxy through buildPlatformContainerConfig', () => {
      const config = buildPlatformContainerConfig(
        normalizeProxyAddress('proxy.internal:17323'),
        'agv_tok',
        CA_PEM,
      )

      expect(config.env.HTTPS_PROXY).to.equal('http://x-agent-vault:agv_tok@proxy.internal:17323')
      expect(config.env.NO_PROXY).to.equal('localhost,127.0.0.1,proxy.internal')
      expect(config.caCertificate).to.equal(CA_PEM)
    })
  })
})
