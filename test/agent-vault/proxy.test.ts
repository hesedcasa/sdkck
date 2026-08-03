import {expect} from 'chai'
import {lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {
  AgentVault,
  AgentVaultError,
  ApiError,
  applyProxyEnv,
  defaultCertPath,
  interceptRequests,
  writeCaCertificate,
} from '../../src/agent-vault/index.js'

/** Windows has no POSIX permission bits, so mode assertions only run on POSIX. */
const posixOnly = process.platform === 'win32' ? it.skip : it

const CA_PEM = '-----BEGIN CERTIFICATE-----\nstub\n-----END CERTIFICATE-----\n'

interface StubOptions {
  /** Status for `GET /v1/mitm/ca.pem`. 404 means the server runs with MITM disabled. */
  caStatus?: number
  /** Status for `GET /discover`, the agent-mode token check. */
  discoverStatus?: number
  /** Vault the token reports being scoped to. */
  discoverVault?: string
  /** Status for `POST /v1/sessions`. 403 is what a `proxy`-role token gets. */
  sessionStatus?: number
}

/** A stub broker that records the calls made to it, so tests can assert on them. */
type StubFetch = typeof globalThis.fetch & {calls: string[]}

function stubFetch(options?: StubOptions): StubFetch {
  const calls: string[] = []

  const fn = (async (url: string | URL, init?: {method?: string}) => {
    const target = String(url)
    calls.push(`${init?.method ?? 'GET'} ${new URL(target).pathname}`)

    if (target.endsWith('/v1/mitm/ca.pem')) {
      return new Response(CA_PEM, {status: options?.caStatus ?? 200})
    }

    if (target.endsWith('/discover')) {
      return new Response(JSON.stringify({vault: options?.discoverVault ?? 'my-project'}), {
        status: options?.discoverStatus ?? 200,
      })
    }

    return new Response(
      // eslint-disable-next-line camelcase -- wire field names
      JSON.stringify({av_addr: 'http://localhost:14321', expires_at: '2026-01-01T00:00:00Z', token: 'av_ses_abc'}),
      {status: options?.sessionStatus ?? 200},
    )
  }) as unknown as StubFetch

  fn.calls = calls
  return fn
}

/** A vault client backed by the stub broker. */
function stubVault(options?: StubOptions, fetch = stubFetch(options)) {
  return new AgentVault({address: 'http://localhost:14321', fetch, token: 'av_agt_abc'}).vault('my-project')
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
    it('writes the PEM, creating parent directories', async () => {
      const certPath = join(tmpDir, 'nested', 'ca.pem')

      const written = await writeCaCertificate({caCertificate: CA_PEM, env: {} as never}, certPath)

      expect(written).to.equal(certPath)
      expect(await readFile(certPath, 'utf8')).to.equal(CA_PEM)
    })

    posixOnly('gives the certificate owner-only permissions', async () => {
      const certPath = join(tmpDir, 'ca.pem')

      await writeCaCertificate({caCertificate: CA_PEM, env: {} as never}, certPath)

      expect(((await stat(certPath)).mode % 0o1000).toString(8)).to.equal('600')
    })

    it('overwrites an existing certificate in place', async () => {
      const certPath = join(tmpDir, 'ca.pem')
      await writeFile(certPath, 'stale certificate that is longer than the new one', 'utf8')

      await writeCaCertificate({caCertificate: CA_PEM, env: {} as never}, certPath)

      expect(await readFile(certPath, 'utf8')).to.equal(CA_PEM)
    })

    posixOnly('replaces a symbolic link instead of writing through it', async () => {
      const victim = join(tmpDir, 'victim.txt')
      const certPath = join(tmpDir, 'ca.pem')
      await writeFile(victim, 'do not clobber me', 'utf8')
      await symlink(victim, certPath)

      await writeCaCertificate({caCertificate: CA_PEM, env: {} as never}, certPath)

      // The link is gone, the certificate is a regular file, the target intact.
      expect((await lstat(certPath)).isSymbolicLink()).to.equal(false)
      expect(await readFile(certPath, 'utf8')).to.equal(CA_PEM)
      expect(await readFile(victim, 'utf8')).to.equal('do not clobber me')
    })

    posixOnly('leaves a symlinked directory entry outside the final component alone', async () => {
      // Only the final component is unlinked; a symlinked parent still resolves.
      const realDir = join(tmpDir, 'real')
      const linkDir = join(tmpDir, 'link')
      await mkdir(realDir)
      await symlink(realDir, linkDir)

      await writeCaCertificate({caCertificate: CA_PEM, env: {} as never}, join(linkDir, 'ca.pem'))

      expect(await readFile(join(realDir, 'ca.pem'), 'utf8')).to.equal(CA_PEM)
    })
  })

  describe('defaultCertPath', () => {
    it('is a file in a private directory, stable within the process', async () => {
      const first = await defaultCertPath()
      const second = await defaultCertPath()

      expect(first).to.equal(second)
      expect(first.startsWith(tmpdir())).to.equal(true)
      // Not the predictable shared path — the directory is created per process.
      expect(first).to.not.equal(join(tmpdir(), 'agent-vault-ca.pem'))
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

    it('drops an inherited lowercase proxy variable that would otherwise win', () => {
      // Some clients (curl, libcurl-backed Python) read the lowercase spelling
      // first, so a stale corporate https_proxy left in the parent environment
      // would silently route around the broker.
      // eslint-disable-next-line camelcase -- the lowercase spelling is the point
      const target: NodeJS.ProcessEnv = {https_proxy: 'http://corporate:3128', KEEP: 'kept'}

      applyProxyEnv({HTTPS_PROXY: 'http://broker:14322'}, target)

      expect(target.https_proxy).to.equal(undefined)
      expect(target.HTTPS_PROXY).to.equal('http://broker:14322')
      expect(target.KEEP).to.equal('kept')
    })

    it('leaves unrelated lowercase variables alone', () => {
      // eslint-disable-next-line camelcase -- the lowercase spelling is the point
      const target: NodeJS.ProcessEnv = {ssl_cert_file: '/custom/ca.pem'}

      applyProxyEnv({HTTPS_PROXY: 'http://broker:14322'}, target)

      // Only keys the caller is actually setting get their variants cleared.
      expect(target.ssl_cert_file).to.equal('/custom/ca.pem')
    })
  })

  describe('interceptRequests', () => {
    it('mints a session, writes the CA and applies the proxy environment', async () => {
      const certPath = join(tmpDir, 'ca.pem')
      const env: NodeJS.ProcessEnv = {}

      const result = await interceptRequests(stubVault(), {certPath, env, ttlSeconds: 900})

      expect(result.certPath).to.equal(certPath)
      expect(result.mode).to.equal('session')
      expect(result.session?.token).to.equal('av_ses_abc')
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

      const result = await interceptRequests(stubVault(), {certPath, env: {}, skipCertWrite: true})

      expect(result.certPath).to.equal(certPath)
      const readError = await readFile(certPath, 'utf8').catch((error: unknown) => error)
      expect(readError).to.be.instanceOf(Error)
    })

    it('fails loudly when the server has MITM disabled', async () => {
      const error = await interceptRequests(stubVault({caStatus: 404}), {
        certPath: join(tmpDir, 'ca.pem'),
        env: {},
      }).catch((error_: unknown) => error_)

      expect(error).to.be.instanceOf(AgentVaultError)
      expect((error as AgentVaultError).message).to.match(/MITM disabled/)
    })

    it('merges noProxy into NO_PROXY, alongside the broker-provided entries', async () => {
      const env: NodeJS.ProcessEnv = {}

      await interceptRequests(stubVault(), {
        certPath: join(tmpDir, 'ca.pem'),
        env,
        noProxy: '10.40.1.11,*.internal',
      })

      expect(env.NO_PROXY).to.equal('localhost,127.0.0.1,localhost,10.40.1.11,*.internal')
    })

    it('preserves NO_PROXY entries already present in the target environment', async () => {
      // A caller that already had bypasses configured (e.g. inherited from the
      // parent shell) must not lose them just because interception turned on.
      const env: NodeJS.ProcessEnv = {NO_PROXY: 'parent.internal,10.1.2.3'}

      await interceptRequests(stubVault(), {
        certPath: join(tmpDir, 'ca.pem'),
        env,
        noProxy: 'config.internal',
      })

      expect(env.NO_PROXY).to.equal('localhost,127.0.0.1,localhost,parent.internal,10.1.2.3,config.internal')
    })

    it('preserves a POSIX-lowercase no_proxy the target environment only had in that spelling', async () => {
      // eslint-disable-next-line camelcase -- the lowercase spelling is the point
      const env: NodeJS.ProcessEnv = {no_proxy: 'parent.internal,10.1.2.3'}

      await interceptRequests(stubVault(), {certPath: join(tmpDir, 'ca.pem'), env, noProxy: 'config.internal'})

      expect(env.NO_PROXY).to.equal('localhost,127.0.0.1,localhost,parent.internal,10.1.2.3,config.internal')
      // applyProxyEnv's other-spelling cleanup still applies: only the
      // canonical uppercase key survives, now carrying the merged list.
      expect(env.no_proxy).to.equal(undefined)
    })

    it('merges both NO_PROXY and no_proxy when a caller somehow has both set', async () => {
      // eslint-disable-next-line camelcase -- the lowercase spelling is the point
      const env: NodeJS.ProcessEnv = {no_proxy: 'lower.internal', NO_PROXY: 'upper.internal'}

      await interceptRequests(stubVault(), {certPath: join(tmpDir, 'ca.pem'), env})

      expect(env.NO_PROXY).to.equal('localhost,127.0.0.1,localhost,upper.internal,lower.internal')
    })

    it('skips hosts already present in NO_PROXY instead of duplicating them', async () => {
      const env: NodeJS.ProcessEnv = {}

      await interceptRequests(stubVault(), {
        certPath: join(tmpDir, 'ca.pem'),
        env,
        noProxy: 'localhost,10.40.1.11',
      })

      expect(env.NO_PROXY).to.equal('localhost,127.0.0.1,localhost,10.40.1.11')
    })

    it('leaves NO_PROXY untouched when no extra hosts are given', async () => {
      const env: NodeJS.ProcessEnv = {}

      await interceptRequests(stubVault(), {certPath: join(tmpDir, 'ca.pem'), env})

      expect(env.NO_PROXY).to.equal('localhost,127.0.0.1,localhost')
    })

    it('is reachable as vault.intercept()', async () => {
      const env: NodeJS.ProcessEnv = {}
      const vault = stubVault()

      const result = await vault.intercept({certPath: join(tmpDir, 'ca.pem'), env})

      expect(env.HTTPS_PROXY).to.equal(result.session?.containerConfig?.env.HTTPS_PROXY)
    })
  })

  describe('interceptRequests in agent mode', () => {
    it('uses the instance token as the proxy credential without minting a session', async () => {
      const env: NodeJS.ProcessEnv = {}
      const fetch = stubFetch()

      const result = await interceptRequests(stubVault(undefined, fetch), {
        certPath: join(tmpDir, 'ca.pem'),
        env,
        mode: 'agent',
      })

      expect(result.mode).to.equal('agent')
      // No session exists to report — the token was used as it arrived.
      expect(result.session).to.equal(null)
      expect(env.HTTPS_PROXY).to.equal('http://av_agt_abc:my-project@localhost:14322')
      expect(fetch.calls).to.not.include('POST /v1/sessions')
    })

    it('validates the token against the broker before routing anything through it', async () => {
      const fetch = stubFetch()

      await interceptRequests(stubVault(undefined, fetch), {
        certPath: join(tmpDir, 'ca.pem'),
        env: {},
        mode: 'agent',
      })

      expect(fetch.calls).to.include('GET /discover')
    })

    it('fails closed when the broker rejects the token', async () => {
      const env: NodeJS.ProcessEnv = {}

      const error = await interceptRequests(stubVault({discoverStatus: 403}), {
        certPath: join(tmpDir, 'ca.pem'),
        env,
        mode: 'agent',
      }).catch((error_: unknown) => error_)

      expect(error).to.be.instanceOf(AgentVaultError)
      expect((error as Error).message).to.match(/rejected the token/)
      // Nothing was applied, so no caller is left believing it is brokered.
      expect(env.HTTPS_PROXY).to.equal(undefined)
    })

    it('still writes the CA certificate so the proxy is trusted', async () => {
      const certPath = join(tmpDir, 'ca.pem')

      await interceptRequests(stubVault(), {certPath, env: {}, mode: 'agent'})

      expect(await readFile(certPath, 'utf8')).to.equal(CA_PEM)
    })
  })

  describe('interceptRequests in auto mode', () => {
    it('mints a scoped session when the token is allowed to', async () => {
      const env: NodeJS.ProcessEnv = {}

      const result = await interceptRequests(stubVault(), {certPath: join(tmpDir, 'ca.pem'), env, mode: 'auto'})

      expect(result.mode).to.equal('session')
      expect(env.HTTPS_PROXY).to.equal('http://av_ses_abc:my-project@localhost:14322')
    })

    it('falls back to the instance token when the broker forbids minting', async () => {
      // What a `proxy`-role token gets: minting is closed to it by design.
      const env: NodeJS.ProcessEnv = {}

      const result = await interceptRequests(stubVault({sessionStatus: 403}), {
        certPath: join(tmpDir, 'ca.pem'),
        env,
        mode: 'auto',
      })

      expect(result.mode).to.equal('agent')
      expect(env.HTTPS_PROXY).to.equal('http://av_agt_abc:my-project@localhost:14322')
    })

    it('fails closed when the fallback token is rejected too', async () => {
      const env: NodeJS.ProcessEnv = {}

      const error = await interceptRequests(stubVault({discoverStatus: 403, sessionStatus: 403}), {
        certPath: join(tmpDir, 'ca.pem'),
        env,
        mode: 'auto',
      }).catch((error_: unknown) => error_)

      expect(error).to.be.instanceOf(AgentVaultError)
      expect(env.HTTPS_PROXY).to.equal(undefined)
    })

    it('does not mask a non-403 minting failure as a proxy-role token', async () => {
      const error = await interceptRequests(stubVault({sessionStatus: 500}), {
        certPath: join(tmpDir, 'ca.pem'),
        env: {},
        mode: 'auto',
      }).catch((error_: unknown) => error_)

      expect(error).to.be.instanceOf(ApiError)
      expect((error as ApiError).status).to.equal(500)
    })

    it('is the default, so a proxy-role token works with no configuration', async () => {
      const env: NodeJS.ProcessEnv = {}

      const result = await interceptRequests(stubVault({sessionStatus: 403}), {
        certPath: join(tmpDir, 'ca.pem'),
        env,
      })

      expect(result.mode).to.equal('agent')
      expect(env.HTTPS_PROXY).to.equal('http://av_agt_abc:my-project@localhost:14322')
    })
  })
})
