import {expect} from 'chai'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {DISABLE_ENV, runAgentProxyIntercepted, SENTINEL_ENV, shouldIntercept} from '../src/agent-proxy-process.js'
import {AGENT_PROXY_ENV, AgentProxy} from '../src/agent-proxy/index.js'
import {SENTINEL_ENV as AGENT_VAULT_SENTINEL_ENV} from '../src/agent-vault-process.js'

const CA_PEM = '-----BEGIN CERTIFICATE-----\nstub\n-----END CERTIFICATE-----\n'

/** A child that reports what it saw, so assertions cover the real spawn path. */
const REPORT_SCRIPT = `
const out = {
  https_proxy: process.env.HTTPS_PROXY,
  no_proxy: process.env.NO_PROXY,
  node_use_env_proxy: process.env.NODE_USE_ENV_PROXY,
  extra_ca: process.env.NODE_EXTRA_CA_CERTS,
  sentinel: process.env.${SENTINEL_ENV},
  vault_sentinel: process.env.${AGENT_VAULT_SENTINEL_ENV},
  token: process.env.${AGENT_PROXY_ENV.TOKEN} ?? null,
  client_secret: process.env.${AGENT_PROXY_ENV.CLIENT_SECRET} ?? null,
  argv: process.argv.slice(2),
}
require('node:fs').writeFileSync(process.env.REPORT_FILE, JSON.stringify(out))
`

describe('agent-proxy process interception', () => {
  describe('shouldIntercept', () => {
    const address = {[AGENT_PROXY_ENV.ADDRESS]: 'proxy-host:17322'}

    it('is on when an address and a token are both present', () => {
      expect(shouldIntercept({...address, [AGENT_PROXY_ENV.TOKEN]: 'st.abc'})).to.equal(true)
    })

    it('is on when an address and a full machine identity are present', () => {
      expect(
        shouldIntercept({
          ...address,
          [AGENT_PROXY_ENV.CLIENT_ID]: 'client-id',
          [AGENT_PROXY_ENV.CLIENT_SECRET]: 'client-secret',
        }),
      ).to.equal(true)
    })

    it('is off with half a machine identity', () => {
      expect(shouldIntercept({...address, [AGENT_PROXY_ENV.CLIENT_ID]: 'client-id'})).to.equal(false)
      expect(shouldIntercept({...address, [AGENT_PROXY_ENV.CLIENT_SECRET]: 'client-secret'})).to.equal(false)
    })

    it('is off without an address', () => {
      expect(shouldIntercept({[AGENT_PROXY_ENV.TOKEN]: 'st.abc'})).to.equal(false)
      expect(shouldIntercept({})).to.equal(false)
    })

    it('is off inside the re-executed child', () => {
      expect(shouldIntercept({...address, [AGENT_PROXY_ENV.TOKEN]: 'st.abc', [SENTINEL_ENV]: '1'})).to.equal(false)
    })

    it('is off when explicitly disabled', () => {
      expect(shouldIntercept({...address, [AGENT_PROXY_ENV.TOKEN]: 'st.abc', [DISABLE_ENV]: '1'})).to.equal(false)
    })

    it('falls back to the file config for whatever the environment omits', () => {
      expect(shouldIntercept({[AGENT_PROXY_ENV.TOKEN]: 'st.abc'}, {address: 'proxy-host'})).to.equal(true)
      expect(shouldIntercept(address, {token: 'st.file'})).to.equal(true)
      expect(shouldIntercept({}, {address: 'proxy-host', clientId: 'id', clientSecret: 'secret'})).to.equal(true)
      expect(shouldIntercept({}, {address: 'proxy-host'})).to.equal(false)
    })
  })

  describe('runAgentProxyIntercepted', () => {
    let tmpDir: string
    let caPath: string

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-agent-proxy-run-'))
      caPath = join(tmpDir, 'mitm-ca.pem')
      await writeFile(caPath, CA_PEM)
    })

    afterEach(async () => {
      await rm(tmpDir, {force: true, recursive: true})
    })

    const client = () =>
      new AgentProxy({
        address: 'proxy-host:17322',
        caPath,
        envSource: {SDKCK_CONFIG_DIR: tmpDir},
        token: 'st.abc',
      })

    /** Run the reporting child and read back the environment it started with. */
    async function report(options?: {noProxy?: string; sourceEnv?: NodeJS.ProcessEnv}) {
      const reportFile = join(tmpDir, 'report.json')
      // A script file rather than `node -e`: no shell is involved in the spawn,
      // so a multi-line argument would be at the mercy of platform quoting.
      const script = join(tmpDir, 'report.cjs')
      await writeFile(script, REPORT_SCRIPT, 'utf8')

      const code = await runAgentProxyIntercepted({
        agentProxy: client(),
        argv: [script, 'some', 'args'],
        env: {
          [AGENT_PROXY_ENV.ADDRESS]: 'proxy-host:17322',
          [AGENT_PROXY_ENV.CLIENT_SECRET]: 'client-secret',
          [AGENT_PROXY_ENV.TOKEN]: 'st.abc',
          REPORT_FILE: reportFile,
          ...options?.sourceEnv,
        },
        execArgv: [],
        noProxy: options?.noProxy,
      })

      return {code, seen: JSON.parse(await readFile(reportFile, 'utf8'))}
    }

    it('re-executes the invocation with the proxy environment in place', async () => {
      const {code, seen} = await report()

      expect(code).to.equal(0)
      expect(seen.https_proxy).to.equal('http://st.abc@proxy-host:17322')
      expect(seen.node_use_env_proxy).to.equal('1')
      expect(seen.extra_ca).to.match(/sdkck-agent-proxy-.*ca\.pem$/)
      expect(seen.argv).to.deep.equal(['some', 'args'])
    })

    it('marks the child so neither broker intercepts it again', async () => {
      const {seen} = await report()

      expect(seen.sentinel).to.equal('1')
      // One invocation, one HTTPS_PROXY: the child must not chain Agent Vault on top.
      expect(seen.vault_sentinel).to.equal('1')
    })

    it('withholds the Infisical credentials from the child', async () => {
      const {seen} = await report()

      expect(seen.token).to.equal(null)
      expect(seen.client_secret).to.equal(null)
    })

    it('points the CA trust variables at a certificate the child can read', async () => {
      const reportFile = join(tmpDir, 'ca-report.json')
      const script = join(tmpDir, 'read-ca.cjs')
      await writeFile(
        script,
        `require('node:fs').writeFileSync(
           process.env.REPORT_FILE,
           require('node:fs').readFileSync(process.env.NODE_EXTRA_CA_CERTS, 'utf8'),
         )`,
        'utf8',
      )

      const code = await runAgentProxyIntercepted({
        agentProxy: client(),
        argv: [script],
        env: {REPORT_FILE: reportFile},
        execArgv: [],
      })

      expect(code).to.equal(0)
      expect(await readFile(reportFile, 'utf8')).to.equal(CA_PEM)
    })

    it('merges the noProxy option into the child’s NO_PROXY', async () => {
      const {seen} = await report({noProxy: 'jenkins.internal'})

      expect(seen.no_proxy).to.equal('localhost,127.0.0.1,proxy-host,jenkins.internal')
    })

    it('preserves a NO_PROXY the parent process already had', async () => {
      const {seen} = await report({sourceEnv: {NO_PROXY: 'already.internal'}})

      expect(seen.no_proxy).to.equal('localhost,127.0.0.1,proxy-host,already.internal')
    })

    it('passes the child’s exit code through', async () => {
      const script = join(tmpDir, 'exit.cjs')
      await writeFile(script, 'process.exit(42)', 'utf8')

      const code = await runAgentProxyIntercepted({
        agentProxy: client(),
        argv: [script],
        env: {},
        execArgv: [],
      })

      expect(code).to.equal(42)
    })

    it('propagates a credential failure so the caller can fail closed', async () => {
      const broken = new AgentProxy({
        address: 'proxy-host:17322',
        caPath: join(tmpDir, 'absent.pem'),
        envSource: {SDKCK_CONFIG_DIR: tmpDir},
        token: 'st.abc',
      })

      const error = await runAgentProxyIntercepted({
        agentProxy: broken,
        argv: ['-e', 'process.exit(0)'],
        env: {},
        execArgv: [],
      }).catch((error_: unknown) => error_)

      expect((error as Error).message).to.match(/Could not read the Agent Proxy root CA/)
    })
  })
})
