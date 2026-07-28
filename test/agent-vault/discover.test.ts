import {expect} from 'chai'

import {AgentVault, AgentVaultError, ApiError} from '../../src/agent-vault/index.js'

/** Wire shape of `GET /discover`, as the broker returns it. */
function discoverBody(vault: string) {
  return JSON.stringify({
    // eslint-disable-next-line camelcase -- wire field names
    available_credentials: ['ATLASSIAN_API_TOKEN', 'ATLASSIAN_EMAIL'],
    services: [{host: 'example.atlassian.net', name: 'atlassian'}],
    vault,
  })
}

/** Just the request fields these tests assert on. */
interface StubInit {
  headers?: Record<string, string>
  method?: string
}

function stubFetch(respond: (url: string, init?: StubInit) => Response): typeof globalThis.fetch {
  return (async (url: string | URL, init?: StubInit) =>
    respond(String(url), init)) as unknown as typeof globalThis.fetch
}

function vaultClient(fetch: typeof globalThis.fetch, vault = 'my-project') {
  return new AgentVault({address: 'http://localhost:14321', fetch, token: 'av_agt_abc'}).vault(vault)
}

describe('agent-vault discover', () => {
  it('returns the vault, services and credential keys the token can reach', async () => {
    const {discover} = vaultClient(stubFetch(() => new Response(discoverBody('my-project'), {status: 200})))

    const result = await discover.validate()

    expect(result.vault).to.equal('my-project')
    expect(result.services).to.deep.equal([{host: 'example.atlassian.net', name: 'atlassian'}])
    expect(result.availableCredentials).to.deep.equal(['ATLASSIAN_API_TOKEN', 'ATLASSIAN_EMAIL'])
  })

  it('scopes the request to the vault so an instance token lands on the right one', async () => {
    let seenVaultHeader: null | string = null
    const {discover} = vaultClient(
      stubFetch((url, init) => {
        expect(url).to.equal('http://localhost:14321/discover')
        seenVaultHeader = init?.headers?.['X-Vault'] ?? null
        return new Response(discoverBody('my-project'), {status: 200})
      }),
    )

    await discover.validate()

    expect(seenVaultHeader).to.equal('my-project')
  })

  it('rejects a token the broker answers 401 for, naming the vault', async () => {
    const {discover} = vaultClient(stubFetch(() => new Response('', {status: 401})))

    const error = await discover.validate().catch((error_: unknown) => error_)

    expect(error).to.be.instanceOf(AgentVaultError)
    expect((error as Error).message).to.match(/rejected the token \(HTTP 401\)/)
    expect((error as Error).message).to.include('my-project')
  })

  it('rejects a token the broker answers 403 for', async () => {
    const {discover} = vaultClient(stubFetch(() => new Response('', {status: 403})))

    const error = await discover.validate().catch((error_: unknown) => error_)

    expect(error).to.be.instanceOf(AgentVaultError)
    expect((error as Error).message).to.match(/rejected the token \(HTTP 403\)/)
  })

  it('rejects a token scoped to a different vault than the one requested', async () => {
    const {discover} = vaultClient(stubFetch(() => new Response(discoverBody('other-project'), {status: 200})))

    const error = await discover.validate().catch((error_: unknown) => error_)

    expect(error).to.be.instanceOf(AgentVaultError)
    expect((error as Error).message).to.match(/Vault mismatch/)
    expect((error as Error).message).to.include('other-project')
  })

  it('surfaces an unexpected server error as an ApiError', async () => {
    const {discover} = vaultClient(stubFetch(() => new Response(JSON.stringify({error: 'boom'}), {status: 500})))

    const error = await discover.validate().catch((error_: unknown) => error_)

    expect(error).to.be.instanceOf(ApiError)
    expect((error as ApiError).status).to.equal(500)
  })
})
