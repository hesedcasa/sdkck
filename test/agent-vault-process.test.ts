import {expect} from 'chai'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {createServer, type Server} from 'node:http'
import {type AddressInfo} from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {
  CA_FINGERPRINT_ENV,
  DISABLE_ENV,
  PROXY_ENV,
  runIntercepted,
  SENTINEL_ENV,
  SESSION_TOKEN_ENV,
  shouldIntercept,
  TOKEN_ENV,
  VAULT_ENV,
} from '../src/agent-vault-process.js'
import {AgentVault, AgentVaultError} from '../src/agent-vault/index.js'

const CA_PEM = '-----BEGIN CERTIFICATE-----\nstub\n-----END CERTIFICATE-----\n'

/**
 * An Agent Vault client backed by a stub server, so no network is involved.
 *
 * `sessionStatus: 403` reproduces a `proxy`-role token, which the broker refuses
 * to mint sessions from.
 */
function stubAgentVault(options?: {sessionStatus?: number}): AgentVault {
  const fetch = (async (url: string | URL) => {
    const target = String(url)
    if (target.endsWith('/v1/mitm/ca.pem')) return new Response(CA_PEM, {status: 200})
    if (target.endsWith('/discover')) return new Response(JSON.stringify({vault: 'my-project'}), {status: 200})

    return new Response(
      JSON.stringify({av_addr: 'http://localhost:14321', expires_at: '2026-01-01T00:00:00Z', token: 'av_ses_abc'}),
      {status: options?.sessionStatus ?? 200},
    )
  }) as unknown as typeof globalThis.fetch

  return new AgentVault({address: 'http://localhost:14321', fetch, token: 'av_agt_abc'})
}

/** A stub platform proxy serving the CA envelope on /_agent-vault/ca. */
async function startPlatformStub(): Promise<{server: Server; url: URL}> {
  const server = createServer((_request, response) => {
    response.writeHead(200, {'Content-Type': 'application/json'})
    response.end(JSON.stringify({certificate: CA_PEM}))
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const {port} = server.address() as AddressInfo
  return {server, url: new URL(`http://127.0.0.1:${port}`)}
}

function stopPlatformStub(server: Server): Promise<void> {
  server.closeAllConnections()
  return new Promise((resolve) => {
    server.close(() => resolve())
  })
}

/** A child that reports what it saw, so assertions cover the real spawn path. */
const REPORT_SCRIPT = `
const out = {
  https_proxy: process.env.HTTPS_PROXY,
  no_proxy: process.env.NO_PROXY,
  node_use_env_proxy: process.env.NODE_USE_ENV_PROXY,
  extra_ca: process.env.NODE_EXTRA_CA_CERTS,
  sentinel: process.env.${SENTINEL_ENV},
  token: process.env.${TOKEN_ENV} ?? null,
  vault: process.env.${VAULT_ENV} ?? null,
  session_token: process.env.${SESSION_TOKEN_ENV} ?? null,
  proxy: process.env.${PROXY_ENV} ?? null,
  ca_fingerprint: process.env.${CA_FINGERPRINT_ENV} ?? null,
  argv: process.argv.slice(2),
}
require('node:fs').writeFileSync(process.env.REPORT_FILE, JSON.stringify(out))
`

describe('agent-vault process interception', () => {
  describe('shouldIntercept', () => {
    it('detects a broker target when a token and a vault name are both present', () => {
      expect(shouldIntercept({[TOKEN_ENV]: 'av_agt_abc', [VAULT_ENV]: 'my-project'})).to.deep.equal({
        kind: 'broker',
        vault: 'my-project',
      })
    })

    it('stays off when either broker half is missing', () => {
      expect(shouldIntercept({[TOKEN_ENV]: 'av_agt_abc'})).to.equal(undefined)
      expect(shouldIntercept({[VAULT_ENV]: 'my-project'})).to.equal(undefined)
      expect(shouldIntercept({})).to.equal(undefined)
    })

    it('is off inside the re-executed child', () => {
      expect(
        shouldIntercept({
          [PROXY_ENV]: 'proxy.internal:17323',
          [SENTINEL_ENV]: '1',
          [SESSION_TOKEN_ENV]: 'agv_abc',
          [TOKEN_ENV]: 'av_agt_abc',
          [VAULT_ENV]: 'my-project',
        }),
      ).to.equal(undefined)
    })

    it('is off when explicitly disabled', () => {
      expect(
        shouldIntercept({
          [DISABLE_ENV]: '1',
          [PROXY_ENV]: 'proxy.internal:17323',
          [SESSION_TOKEN_ENV]: 'agv_abc',
        }),
      ).to.equal(undefined)
    })

    it('falls back to the file config for whichever broker half is missing from the environment', () => {
      expect(shouldIntercept({[TOKEN_ENV]: 'av_agt_abc'}, {vault: 'my-project'})).to.deep.equal({
        kind: 'broker',
        vault: 'my-project',
      })
      expect(shouldIntercept({}, {token: 'av_agt_file', vault: 'my-project'})).to.deep.equal({
        kind: 'broker',
        vault: 'my-project',
      })
    })

    it('prefers the environment over the file config', () => {
      expect(
        shouldIntercept({[TOKEN_ENV]: 'av_agt_abc', [VAULT_ENV]: 'env-project'}, {vault: 'file-project'}),
      ).to.deep.equal({kind: 'broker', vault: 'env-project'})
    })

    it('detects a platform target when the session token and proxy are both set', () => {
      expect(shouldIntercept({[PROXY_ENV]: 'proxy.internal:17323', [SESSION_TOKEN_ENV]: 'agv_abc'})).to.deep.equal({
        caFingerprint: undefined,
        kind: 'platform',
        proxy: 'proxy.internal:17323',
        sessionToken: 'agv_abc',
      })
    })

    it('carries the CA fingerprint pin through', () => {
      expect(
        shouldIntercept({
          [CA_FINGERPRINT_ENV]: 'SHA256:ABCD',
          [PROXY_ENV]: 'proxy.internal:17323',
          [SESSION_TOKEN_ENV]: 'agv_abc',
        }),
      ).to.deep.equal({
        caFingerprint: 'SHA256:ABCD',
        kind: 'platform',
        proxy: 'proxy.internal:17323',
        sessionToken: 'agv_abc',
      })
    })

    it('treats an empty CA fingerprint env as unset so the file-config pin still applies', () => {
      expect(
        shouldIntercept(
          {[CA_FINGERPRINT_ENV]: '  ', [PROXY_ENV]: 'proxy.internal:17323', [SESSION_TOKEN_ENV]: 'agv_abc'},
          {caFingerprint: 'SHA256:ABCD'},
        ),
      ).to.deep.equal({
        caFingerprint: 'SHA256:ABCD',
        kind: 'platform',
        proxy: 'proxy.internal:17323',
        sessionToken: 'agv_abc',
      })
    })

    it('resolves platform fields from the file config, env winning per field', () => {
      expect(
        shouldIntercept({[PROXY_ENV]: 'env.internal:17323'}, {proxy: 'file.internal:17323', sessionToken: 'agv_file'}),
      ).to.deep.equal({
        caFingerprint: undefined,
        kind: 'platform',
        proxy: 'env.internal:17323',
        sessionToken: 'agv_file',
      })
    })

    it('throws when only the session token is set', () => {
      expect(() => shouldIntercept({[SESSION_TOKEN_ENV]: 'agv_abc'})).to.throw(AgentVaultError, /AGENT_VAULT_PROXY/)
      expect(() => shouldIntercept({}, {sessionToken: 'agv_file'})).to.throw(AgentVaultError, /AGENT_VAULT_PROXY/)
    })

    it('throws when only the proxy is set', () => {
      expect(() => shouldIntercept({[PROXY_ENV]: 'proxy.internal:17323'})).to.throw(
        AgentVaultError,
        /AGENT_VAULT_SESSION_TOKEN/,
      )
    })

    it('prefers the platform backend when both backends are fully configured', () => {
      expect(
        shouldIntercept({
          [PROXY_ENV]: 'proxy.internal:17323',
          [SESSION_TOKEN_ENV]: 'agv_abc',
          [TOKEN_ENV]: 'av_agt_abc',
          [VAULT_ENV]: 'my-project',
        }),
      ).to.deep.equal({
        caFingerprint: undefined,
        kind: 'platform',
        proxy: 'proxy.internal:17323',
        sessionToken: 'agv_abc',
      })
    })
  })

  describe('runIntercepted', () => {
    let tmpDir: string

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-intercept-'))
    })

    afterEach(async () => {
      await rm(tmpDir, {force: true, recursive: true})
    })

    it('re-executes the invocation with the proxy environment in place', async () => {
      const reportFile = join(tmpDir, 'report.json')
      // A script file rather than `node -e`: no shell is involved in the spawn,
      // so a multi-line argument would be at the mercy of platform quoting.
      const script = join(tmpDir, 'report.cjs')
      await writeFile(script, REPORT_SCRIPT, 'utf8')

      const code = await runIntercepted({
        agentVault: stubAgentVault(),
        argv: [script, 'some', 'args'],
        env: {REPORT_FILE: reportFile, [TOKEN_ENV]: 'av_agt_abc', [VAULT_ENV]: 'my-project'},
        execArgv: [],
        target: {kind: 'broker', vault: 'my-project'},
      })

      expect(code).to.equal(0)
      const seen = JSON.parse(await readFile(reportFile, 'utf8'))

      // The child starts with the proxy variables, which is the whole point:
      // Node only honours them at startup.
      expect(seen.https_proxy).to.equal('http://av_ses_abc:my-project@localhost:14322')
      expect(seen.node_use_env_proxy).to.equal('1')
      expect(seen.no_proxy).to.equal('localhost,127.0.0.1,localhost')
      expect(seen.sentinel).to.equal('1')
      expect(seen.argv).to.deep.equal(['some', 'args'])

      // The instance-level token is withheld: the child only needs the scoped
      // session token, which rides inside the proxy URL.
      expect(seen.token).to.equal(null)
      expect(seen.vault).to.equal('my-project')
    })

    it('merges the noProxy option into the child’s NO_PROXY', async () => {
      const reportFile = join(tmpDir, 'no-proxy-report.json')
      const script = join(tmpDir, 'no-proxy-report.cjs')
      await writeFile(script, REPORT_SCRIPT, 'utf8')

      const code = await runIntercepted({
        agentVault: stubAgentVault(),
        argv: [script],
        env: {REPORT_FILE: reportFile, [TOKEN_ENV]: 'av_agt_abc', [VAULT_ENV]: 'my-project'},
        execArgv: [],
        noProxy: '10.40.1.11,*.internal',
        target: {kind: 'broker', vault: 'my-project'},
      })

      expect(code).to.equal(0)
      const seen = JSON.parse(await readFile(reportFile, 'utf8'))
      expect(seen.no_proxy).to.equal('localhost,127.0.0.1,localhost,10.40.1.11,*.internal')
    })

    it('preserves a NO_PROXY the parent process already had, on top of the configured bypass', async () => {
      const reportFile = join(tmpDir, 'inherited-no-proxy-report.json')
      const script = join(tmpDir, 'inherited-no-proxy-report.cjs')
      await writeFile(script, REPORT_SCRIPT, 'utf8')

      const code = await runIntercepted({
        agentVault: stubAgentVault(),
        argv: [script],
        env: {
          NO_PROXY: 'parent.internal,10.1.2.3',
          REPORT_FILE: reportFile,
          [TOKEN_ENV]: 'av_agt_abc',
          [VAULT_ENV]: 'my-project',
        },
        execArgv: [],
        noProxy: 'config.internal',
        target: {kind: 'broker', vault: 'my-project'},
      })

      expect(code).to.equal(0)
      const seen = JSON.parse(await readFile(reportFile, 'utf8'))
      expect(seen.no_proxy).to.equal('localhost,127.0.0.1,localhost,parent.internal,10.1.2.3,config.internal')
    })

    it('runs with a proxy-role token, which cannot mint a session at all', async () => {
      // The role an agent token is normally granted: the broker answers 403 to
      // POST /v1/sessions, because such a token "can ONLY proxy requests". The
      // token is itself a valid proxy credential, so the run must still proceed.
      const reportFile = join(tmpDir, 'proxy-role.json')
      const script = join(tmpDir, 'proxy-role.cjs')
      await writeFile(script, REPORT_SCRIPT, 'utf8')

      const code = await runIntercepted({
        agentVault: stubAgentVault({sessionStatus: 403}),
        argv: [script],
        env: {REPORT_FILE: reportFile, [TOKEN_ENV]: 'av_agt_abc', [VAULT_ENV]: 'my-project'},
        execArgv: [],
        target: {kind: 'broker', vault: 'my-project'},
      })

      expect(code).to.equal(0)
      const seen = JSON.parse(await readFile(reportFile, 'utf8'))
      expect(seen.https_proxy).to.equal('http://av_agt_abc:my-project@localhost:14322')
      expect(seen.node_use_env_proxy).to.equal('1')
      expect(seen.sentinel).to.equal('1')
    })

    it('points the CA trust variables at a certificate the child can read', async () => {
      const reportFile = join(tmpDir, 'ca-report.json')
      const script = join(tmpDir, 'ca-report.cjs')
      await writeFile(
        script,
        `require('node:fs').writeFileSync(process.env.REPORT_FILE, JSON.stringify({
           extra_ca: process.env.NODE_EXTRA_CA_CERTS,
           pem: require('node:fs').readFileSync(process.env.NODE_EXTRA_CA_CERTS, 'utf8'),
         }))`,
        'utf8',
      )

      await runIntercepted({
        agentVault: stubAgentVault(),
        argv: [script],
        env: {REPORT_FILE: reportFile},
        execArgv: [],
        target: {kind: 'broker', vault: 'my-project'},
      })

      const seen = JSON.parse(await readFile(reportFile, 'utf8'))
      expect(seen.pem).to.equal(CA_PEM)
      expect(seen.extra_ca).to.match(/sdkck-agent-vault-.*ca\.pem$/)
    })

    it('passes the child’s exit code through', async () => {
      const script = join(tmpDir, 'exit3.cjs')
      await writeFile(script, 'process.exit(3)', 'utf8')

      const code = await runIntercepted({
        agentVault: stubAgentVault(),
        argv: [script],
        env: {},
        execArgv: [],
        target: {kind: 'broker', vault: 'my-project'},
      })

      expect(code).to.equal(3)
    })

    it('propagates a minting failure so the caller can fail closed', async () => {
      const fetch = (async () =>
        new Response(JSON.stringify({error: 'forbidden'}), {status: 403})) as unknown as typeof globalThis.fetch

      const error = await runIntercepted({
        agentVault: new AgentVault({fetch, token: 'av_agt_abc'}),
        argv: [join(tmpDir, 'never-runs.cjs')],
        env: {},
        execArgv: [],
        target: {kind: 'broker', vault: 'my-project'},
      }).catch((error_: unknown) => error_)

      expect(error).to.be.instanceOf(Error)
      expect((error as Error).message).to.match(/403|forbidden/)
    })

    it('re-executes with the platform proxy environment and withholds the platform variables', async () => {
      const stub = await startPlatformStub()
      try {
        const reportFile = join(tmpDir, 'platform-report.json')
        const script = join(tmpDir, 'platform-report.cjs')
        await writeFile(script, REPORT_SCRIPT, 'utf8')

        const code = await runIntercepted({
          argv: [script, 'some', 'args'],
          env: {
            [CA_FINGERPRINT_ENV]: 'SHA256:ABCD',
            [PROXY_ENV]: stub.url.origin,
            REPORT_FILE: reportFile,
            [SESSION_TOKEN_ENV]: 'agv_env',
          },
          execArgv: [],
          target: {kind: 'platform', proxy: stub.url.origin, sessionToken: 'agv_env'},
        })

        expect(code).to.equal(0)
        const seen = JSON.parse(await readFile(reportFile, 'utf8'))

        expect(seen.https_proxy).to.equal(`http://x-agent-vault:agv_env@127.0.0.1:${stub.url.port}`)
        expect(seen.node_use_env_proxy).to.equal('1')
        expect(seen.no_proxy).to.equal('localhost,127.0.0.1,127.0.0.1')
        expect(seen.sentinel).to.equal('1')
        expect(seen.argv).to.deep.equal(['some', 'args'])

        // The platform variables are withheld from the child: the session
        // token rides inside the proxy URL, and the sentinel stops re-entry.
        expect(seen.session_token).to.equal(null)
        expect(seen.proxy).to.equal(null)
        expect(seen.ca_fingerprint).to.equal(null)
      } finally {
        await stopPlatformStub(stub.server)
      }
    })

    it('fails closed when the platform CA pin does not match', async () => {
      const stub = await startPlatformStub()
      try {
        const error = await runIntercepted({
          argv: [join(tmpDir, 'never-runs.cjs')],
          env: {},
          execArgv: [],
          target: {caFingerprint: 'sha256:deadbeef', kind: 'platform', proxy: stub.url.origin, sessionToken: 'agv_env'},
        }).catch((error_: unknown) => error_)

        expect(error).to.be.instanceOf(AgentVaultError)
        expect((error as Error).message).to.match(/fingerprint/i)
      } finally {
        await stopPlatformStub(stub.server)
      }
    })

  })
})
