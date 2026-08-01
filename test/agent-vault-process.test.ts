import {expect} from 'chai'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {
  DISABLE_ENV,
  runIntercepted,
  SENTINEL_ENV,
  shouldIntercept,
  TOKEN_ENV,
  VAULT_ENV,
} from '../src/agent-vault-process.js'
import {AgentVault} from '../src/agent-vault/index.js'

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
      // eslint-disable-next-line camelcase -- wire field names
      JSON.stringify({av_addr: 'http://localhost:14321', expires_at: '2026-01-01T00:00:00Z', token: 'av_ses_abc'}),
      {status: options?.sessionStatus ?? 200},
    )
  }) as unknown as typeof globalThis.fetch

  return new AgentVault({address: 'http://localhost:14321', fetch, token: 'av_agt_abc'})
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
  vault: process.env.${VAULT_ENV},
  argv: process.argv.slice(2),
}
require('node:fs').writeFileSync(process.env.REPORT_FILE, JSON.stringify(out))
`

describe('agent-vault process interception', () => {
  describe('shouldIntercept', () => {
    it('is on when a token and a vault name are both present', () => {
      expect(shouldIntercept({[TOKEN_ENV]: 'av_agt_abc', [VAULT_ENV]: 'my-project'})).to.equal('my-project')
    })

    it('is off when either half is missing', () => {
      expect(shouldIntercept({[TOKEN_ENV]: 'av_agt_abc'})).to.equal(undefined)
      expect(shouldIntercept({[VAULT_ENV]: 'my-project'})).to.equal(undefined)
      expect(shouldIntercept({})).to.equal(undefined)
    })

    it('is off inside the re-executed child', () => {
      expect(shouldIntercept({[SENTINEL_ENV]: '1', [TOKEN_ENV]: 'av_agt_abc', [VAULT_ENV]: 'my-project'})).to.equal(
        undefined,
      )
    })

    it('is off when explicitly disabled', () => {
      expect(shouldIntercept({[DISABLE_ENV]: '1', [TOKEN_ENV]: 'av_agt_abc', [VAULT_ENV]: 'my-project'})).to.equal(
        undefined,
      )
    })

    it('falls back to the file config for whichever half is missing from the environment', () => {
      expect(shouldIntercept({[TOKEN_ENV]: 'av_agt_abc'}, {vault: 'my-project'})).to.equal('my-project')
      expect(shouldIntercept({[VAULT_ENV]: 'my-project'}, {token: 'av_agt_file'})).to.equal('my-project')
      expect(shouldIntercept({}, {token: 'av_agt_file', vault: 'my-project'})).to.equal('my-project')
    })

    it('prefers the environment over the file config', () => {
      expect(
        shouldIntercept({[TOKEN_ENV]: 'av_agt_abc', [VAULT_ENV]: 'env-project'}, {vault: 'file-project'}),
      ).to.equal('env-project')
    })

    it('is off when neither source supplies both halves', () => {
      expect(shouldIntercept({[TOKEN_ENV]: 'av_agt_abc'}, {})).to.equal(undefined)
      expect(shouldIntercept({}, {token: 'av_agt_file'})).to.equal(undefined)
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
        vault: 'my-project',
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
        vault: 'my-project',
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
        vault: 'my-project',
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
        vault: 'my-project',
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
        vault: 'my-project',
      }).catch((error_: unknown) => error_)

      expect(error).to.be.instanceOf(Error)
      expect((error as Error).message).to.match(/403|forbidden/)
    })
  })
})
