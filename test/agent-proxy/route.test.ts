import {expect} from 'chai'

import {
  AgentProxyError,
  buildAgentProxyRoute,
  DEFAULT_AGENT_PROXY_PORT,
  defaultCaPath,
  parseProxyAddress,
} from '../../src/agent-proxy/index.js'

const CA_PEM = '-----BEGIN CERTIFICATE-----\nstub\n-----END CERTIFICATE-----\n'

describe('agent-proxy route', () => {
  describe('parseProxyAddress', () => {
    it('fills in the scheme and the documented default port', () => {
      const url = parseProxyAddress('proxy-host')

      expect(url.protocol).to.equal('http:')
      expect(url.hostname).to.equal('proxy-host')
      expect(url.port).to.equal(String(DEFAULT_AGENT_PROXY_PORT))
    })

    it('keeps an explicit port', () => {
      expect(parseProxyAddress('proxy-host:9999').port).to.equal('9999')
    })

    it('keeps an explicit scheme', () => {
      expect(parseProxyAddress('https://proxy-host:17322').protocol).to.equal('https:')
    })

    it('accepts an IPv6 literal', () => {
      expect(parseProxyAddress('[::1]:17322').hostname).to.equal('[::1]')
    })

    it('rejects an empty address', () => {
      expect(() => parseProxyAddress('  ')).to.throw(AgentProxyError, /is empty/)
    })

    it('rejects an address with no host', () => {
      expect(() => parseProxyAddress('http://:17322')).to.throw(AgentProxyError, /Could not parse/)
    })
  })

  describe('buildAgentProxyRoute', () => {
    it('carries the identity token as proxy credentials', () => {
      const route = buildAgentProxyRoute({address: 'proxy-host:17322', caCertificate: CA_PEM, token: 'st.abc'})

      expect(route.env.HTTPS_PROXY).to.equal('http://st.abc@proxy-host:17322')
      expect(route.env.HTTP_PROXY).to.equal(route.env.HTTPS_PROXY)
      expect(route.caCertificate).to.equal(CA_PEM)
    })

    it('bypasses the loopback and the proxy host itself', () => {
      const route = buildAgentProxyRoute({address: 'proxy-host:17322', caCertificate: CA_PEM, token: 'st.abc'})

      expect(route.env.NO_PROXY).to.equal('localhost,127.0.0.1,proxy-host')
    })
  })

  describe('defaultCaPath', () => {
    it('points at the file `agent-proxy connect` writes', () => {
      expect(defaultCaPath('/home/agent')).to.equal('/home/agent/.infisical/agent-proxy/mitm-ca.pem')
    })
  })
})
