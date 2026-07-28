import {expect} from 'chai'
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {AgentVault, AgentVaultError, applyProxyEnv, interceptRequests, writeCaCertificate} from '../../src/agent-vault/index.js'

const CA_PEM = '-----BEGIN CERTIFICATE-----\nstub\n-----END CERTIFICATE-----\n'

function stubFetch(options?: {caStatus?: number}): typeof globalThis.fetch {
  return (async (url: string | URL) => {
    if (String(url).endsWith('/v1/mitm/ca.pem')) {
      return new Response(CA_PEM, {status: options?.caStatus ?? 200})
    }

    return new Response(
      // eslint-disable-next-line camelcase -- wire field names
      JSON.stringify({av_addr: 'http://localhost:14321', expires_at: '2026-01-01T00:00:00Z', token: 'av_ses_abc'}),
      {status: 200},
    )
  }) as unknown as typeof globalThis.fetch
}

describe('agent-vault request interception', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-agent-vault-'))
  })

  afterEach(async () => {
    await rm(tmpDir, {recursive: true})
  })

  describe('writeCaCertificate', () => {
    it('writes the PEM, creating parent directories, with owner-only permissions', async () => {
      const certPath = join(tmpDir, 'nested', 'ca.pem')

      const written = await writeCaCertificate({caCertificate: CA_PEM, env: {} as never}, certPath)

      expect(written).to.equal(certPath)
      expect(await readFile(certPath, 'utf8')).to.equal(CA_PEM)
      expect(((await stat(certPath)).mode % 0o1000).toString(8)).to.equal('600')
    })
  })

  describe('applyProxyEnv', () => {
    it('merges variables into the given environment without touching process.env', () => {
      const target: NodeJS.ProcessEnv = {EXISTING: 'kept'}
      const origProxy = process.env.HTTPS_PROXY

      applyProxyEnv({HTTPS_PROXY: 'http://proxy:14322'}, target)

      expect(target).to.deep.equal({EXISTING: 'kept', HTTPS_PROXY: 'http://proxy:14322'})
      expect(process.env.HTTPS_PROXY).to.equal(origProxy)
    })
  })

  describe('interceptRequests', () => {
    it('mints a session, writes the CA and applies the proxy environment', async () => {
      const certPath = join(tmpDir, 'ca.pem')
      const env: NodeJS.ProcessEnv = {}
      const {sessions} = new AgentVault({address: 'http://localhost:14321', fetch: stubFetch(), token: 'av_agt_abc'})
        .vault('my-project')

      const result = await interceptRequests(sessions, {certPath, env, ttlSeconds: 900})

      expect(result.certPath).to.equal(certPath)
      expect(result.session.token).to.equal('av_ses_abc')
      expect(await readFile(certPath, 'utf8')).to.equal(CA_PEM)

      // Every returned variable is applied to the target environment.
      for (const [key, value] of Object.entries(result.env)) {
        expect(env[key], key).to.equal(value)
      }

      expect(env.HTTPS_PROXY).to.equal('http://av_ses_abc:my-project@localhost:14322')
      expect(env.NODE_USE_ENV_PROXY).to.equal('1')
      expect(env.SSL_CERT_FILE).to.equal(certPath)
    })

    it('can skip the certificate write when it is already on disk', async () => {
      const certPath = join(tmpDir, 'absent.pem')
      const {sessions} = new AgentVault({fetch: stubFetch(), token: 'av_agt_abc'}).vault('my-project')

      const result = await interceptRequests(sessions, {certPath, env: {}, skipCertWrite: true})

      expect(result.certPath).to.equal(certPath)
      const readError = await readFile(certPath, 'utf8').catch((error: unknown) => error)
      expect(readError).to.be.instanceOf(Error)
    })

    it('fails loudly when the server has MITM disabled', async () => {
      const {sessions} = new AgentVault({fetch: stubFetch({caStatus: 404}), token: 'av_agt_abc'}).vault('my-project')

      const error = await interceptRequests(sessions, {certPath: join(tmpDir, 'ca.pem'), env: {}}).catch(
        (error_: unknown) => error_,
      )

      expect(error).to.be.instanceOf(AgentVaultError)
      expect((error as AgentVaultError).message).to.match(/MITM disabled/)
    })

    it('is reachable as vault.intercept()', async () => {
      const env: NodeJS.ProcessEnv = {}
      const vault = new AgentVault({fetch: stubFetch(), token: 'av_agt_abc'}).vault('my-project')

      const result = await vault.intercept({certPath: join(tmpDir, 'ca.pem'), env})

      expect(env.HTTPS_PROXY).to.equal(result.session.containerConfig?.env.HTTPS_PROXY)
    })
  })
})
