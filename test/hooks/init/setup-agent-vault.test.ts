import {expect} from 'chai'

import {DISABLE_ENV, FALLBACK_ENV, SENTINEL_ENV, TOKEN_ENV, VAULT_ENV} from '../../../src/agent-vault-process.js'
import hook from '../../../src/hooks/init/setup-agent-vault.js'

type HookOpts = Parameters<typeof hook>[0]
type HookContext = ThisParameterType<typeof hook>

const OPTS: HookOpts = {
  argv: [],
  config: {runHook: async () => ({failures: [], successes: []})} as unknown as HookOpts['config'],
  context: {} as HookOpts['context'],
  id: undefined,
}

/** A hook context that records warnings and turns `error` into a throw. */
function makeContext(warnings: string[]): HookContext {
  return {
    error(input: Error | string) {
      throw new Error(typeof input === 'string' ? input : input.message)
    },
    warn(input: Error | string) {
      warnings.push(String(typeof input === 'string' ? input : input.message))
      return input
    },
  } as unknown as HookContext
}

describe('setup-agent-vault hook', () => {
  const saved = {...process.env}

  beforeEach(() => {
    // Port 1 is not listening, so resolving a credential fails at once.
    process.env.AGENT_VAULT_ADDR = 'http://127.0.0.1:1'
    process.env[TOKEN_ENV] = 'av_agt_abc'
    process.env[VAULT_ENV] = 'my-project'
    delete process.env[FALLBACK_ENV]
    // A developer plausibly has the escape hatch exported from prior use; clear
    // it (and the child sentinel) so `shouldIntercept()` doesn't return early.
    delete process.env[DISABLE_ENV]
    delete process.env[SENTINEL_ENV]
  })

  afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
    Object.assign(process.env, saved)
  })

  it('warns and runs the command unbrokered when fallback is enabled', async () => {
    process.env[FALLBACK_ENV] = '1'
    const warnings: string[] = []

    // Returning normally is the contract: oclif then dispatches the command in
    // this process, without the proxy environment.
    await hook.call(makeContext(warnings), OPTS)

    expect(warnings).to.have.length(1)
    expect(warnings[0]).to.match(/^Agent Vault unavailable for vault "my-project": /)
    expect(warnings[0]).to.match(/Running without brokered credentials\.$/)
  })

  it('fails closed when fallback is not enabled', async () => {
    const warnings: string[] = []

    const error = await hook.call(makeContext(warnings), OPTS).catch((error_: unknown) => error_)

    expect(error).to.be.instanceOf(Error)
    expect((error as Error).message).to.match(/could not be set up for vault "my-project"/)
    expect(warnings).to.be.empty
  })

  it('removes the instance token from the environment on the fallback path', async () => {
    process.env[FALLBACK_ENV] = '1'
    const warnings: string[] = []

    // afterEach restores the real environment regardless of what this leaves
    // behind, so it's safe to assert the token is gone here.
    await hook.call(makeContext(warnings), OPTS)

    expect(process.env[TOKEN_ENV]).to.equal(undefined)
  })
})
