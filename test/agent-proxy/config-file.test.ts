import {expect} from 'chai'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {AgentProxyError, readAgentProxyFileConfig} from '../../src/agent-proxy/index.js'

describe('readAgentProxyFileConfig', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-agent-proxy-config-'))
  })

  afterEach(async () => {
    await rm(tmpDir, {force: true, recursive: true})
  })

  const write = async (contents: string) => writeFile(join(tmpDir, 'agent-proxy.json'), contents)

  it('returns an empty config when the file is absent', () => {
    expect(readAgentProxyFileConfig(tmpDir)).to.deep.equal({})
  })

  it('reads every supported field', async () => {
    await write(
      JSON.stringify({
        address: 'proxy-host:17322',
        caPath: '/etc/ca.pem',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        domain: 'https://eu.infisical.com',
        noProxy: 'jenkins.internal',
        token: 'st.abc',
      }),
    )

    expect(readAgentProxyFileConfig(tmpDir)).to.deep.equal({
      address: 'proxy-host:17322',
      caPath: '/etc/ca.pem',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      domain: 'https://eu.infisical.com',
      noProxy: 'jenkins.internal',
      token: 'st.abc',
    })
  })

  it('ignores unknown fields', async () => {
    await write(JSON.stringify({address: 'proxy-host', projectId: 'p-1'}))

    expect(readAgentProxyFileConfig(tmpDir)).to.deep.equal({address: 'proxy-host'})
  })

  it('throws when the file is not valid JSON', async () => {
    await write('{oops')

    expect(() => readAgentProxyFileConfig(tmpDir)).to.throw(AgentProxyError, /Could not parse/)
  })

  it('throws when the file is a JSON array', async () => {
    await write('[]')

    expect(() => readAgentProxyFileConfig(tmpDir)).to.throw(AgentProxyError, /must contain a JSON object/)
  })

  it('throws when a field is not a string', async () => {
    await write(JSON.stringify({address: 17_322}))

    expect(() => readAgentProxyFileConfig(tmpDir)).to.throw(AgentProxyError, /"address" must be a string/)
  })
})
