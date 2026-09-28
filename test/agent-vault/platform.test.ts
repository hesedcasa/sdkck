import {expect} from 'chai'
import {Buffer} from 'node:buffer'
import {createHash} from 'node:crypto'
import {createServer, type Server} from 'node:http'
import {type AddressInfo} from 'node:net'

import {AgentVaultError, ApiError} from '../../src/agent-vault/errors.js'
import {
  certificateFingerprint,
  fetchProxyCa,
  normalizeFingerprint,
  normalizeProxyAddress,
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
})
