import type {Hook} from '@oclif/core'

import {expect} from 'chai'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import hook from '../../../src/hooks/init/setup-agent-vault.js'

type HookOpts = Parameters<typeof hook>[0]
type HookContext = Hook.Context

function makeOpts(configDir: string): HookOpts {
  return {
    argv: [],
    config: {configDir} as unknown as HookOpts['config'],
    context: {} as HookOpts['context'],
    id: undefined,
  }
}

/** A `Hook.Context` stand-in that records the message passed to `this.error`. */
function makeContext(configDir: string): {context: HookContext; errorMessage: () => string | undefined} {
  let errorMessage: string | undefined
  const context = {
    config: {configDir},
    error(message: Error | string): never {
      errorMessage = message instanceof Error ? message.message : message
      throw message instanceof Error ? message : new Error(message)
    },
  } as unknown as HookContext

  return {context, errorMessage: () => errorMessage}
}

describe('init/setup-agent-vault hook', () => {
  const envKeys = [
    'AGENT_VAULT_TOKEN',
    'AGENT_VAULT_VAULT',
    'AGENT_VAULT_ADDR',
    'SDKCK_AGENT_VAULT_DISABLED',
    'SDKCK_AGENT_VAULT_ACTIVE',
  ]
  const originalEnv: Record<string, string | undefined> = {}
  let tmpDir: string

  beforeEach(async () => {
    for (const key of envKeys) {
      originalEnv[key] = process.env[key]
      delete process.env[key]
    }

    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-agent-vault-hook-'))
  })

  afterEach(async () => {
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key]
      else process.env[key] = originalEnv[key]
    }

    await rm(tmpDir, {force: true, recursive: true})
  })

  it('is a no-op when neither the environment nor the config file supply a token and vault', async () => {
    const {context} = makeContext(tmpDir)
    await hook.call(context, makeOpts(tmpDir))
    // No throw, and nothing left to assert: the hook returned without touching
    // interception at all.
  })

  it('attempts interception using a vault name resolved from the config file', async () => {
    await writeFile(
      join(tmpDir, 'agent-vault.json'),
      JSON.stringify({token: 'av_agt_file', vault: 'file-project'}),
      'utf8',
    )
    const {context, errorMessage} = makeContext(tmpDir)

    // No broker is actually listening in the test environment, so setup fails
    // — but the failure message proves the file-resolved vault name drove the
    // decision to intercept in the first place, and that it fails closed
    // rather than silently running unbrokered.
    const error = await hook.call(context, makeOpts(tmpDir)).catch((error_: unknown) => error_)

    expect(error).to.be.instanceOf(Error)
    expect(errorMessage()).to.match(/vault "file-project"/)
    expect(errorMessage()).to.match(/command was not run/)
  })

  it('prefers an environment-supplied vault over the config file', async () => {
    await writeFile(join(tmpDir, 'agent-vault.json'), JSON.stringify({vault: 'file-project'}), 'utf8')
    process.env.AGENT_VAULT_TOKEN = 'av_agt_env'
    process.env.AGENT_VAULT_VAULT = 'env-project'
    const {context, errorMessage} = makeContext(tmpDir)

    await hook.call(context, makeOpts(tmpDir)).catch((error_: unknown) => error_)

    expect(errorMessage()).to.match(/vault "env-project"/)
  })

  it('does not attempt interception when disabled, even with a complete file config', async () => {
    await writeFile(
      join(tmpDir, 'agent-vault.json'),
      JSON.stringify({token: 'av_agt_file', vault: 'file-project'}),
      'utf8',
    )
    process.env.SDKCK_AGENT_VAULT_DISABLED = '1'
    const {context} = makeContext(tmpDir)

    await hook.call(context, makeOpts(tmpDir))
  })

  // A malformed file must never surface as a broken disable/child bypass —
  // those checks are meant to run unconditionally, before the file is ever
  // touched.
  it('honors SDKCK_AGENT_VAULT_DISABLED without reading the config file at all', async () => {
    await writeFile(join(tmpDir, 'agent-vault.json'), '{not json', 'utf8')
    process.env.SDKCK_AGENT_VAULT_DISABLED = '1'
    const {context} = makeContext(tmpDir)

    await hook.call(context, makeOpts(tmpDir))
  })

  it('honors the re-executed-child sentinel without reading the config file at all', async () => {
    await writeFile(join(tmpDir, 'agent-vault.json'), '{not json', 'utf8')
    process.env.SDKCK_AGENT_VAULT_ACTIVE = '1'
    const {context} = makeContext(tmpDir)

    await hook.call(context, makeOpts(tmpDir))
  })
})
