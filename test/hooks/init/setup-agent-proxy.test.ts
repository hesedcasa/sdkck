import type {Hook} from '@oclif/core'

import {expect} from 'chai'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import hook from '../../../src/hooks/init/setup-agent-proxy.js'

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

describe('init/setup-agent-proxy hook', () => {
  const envKeys = [
    'INFISICAL_AGENT_PROXY_ADDRESS',
    'INFISICAL_AGENT_PROXY_CA',
    'INFISICAL_TOKEN',
    'INFISICAL_UNIVERSAL_AUTH_CLIENT_ID',
    'INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET',
    'SDKCK_AGENT_PROXY_DISABLED',
    'SDKCK_AGENT_PROXY_ACTIVE',
  ]
  const originalEnv: Record<string, string | undefined> = {}
  let tmpDir: string

  beforeEach(async () => {
    for (const key of envKeys) {
      originalEnv[key] = process.env[key]
      delete process.env[key]
    }

    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-agent-proxy-hook-'))
  })

  afterEach(async () => {
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key]
      else process.env[key] = originalEnv[key]
    }

    await rm(tmpDir, {force: true, recursive: true})
  })

  it('is a no-op when neither the environment nor the config file supply an address and a credential', async () => {
    const {context} = makeContext(tmpDir)
    await hook.call(context, makeOpts(tmpDir))
    // No throw, and nothing left to assert: the hook returned without touching
    // interception at all.
  })

  it('is a no-op with an address but no credential', async () => {
    process.env.INFISICAL_AGENT_PROXY_ADDRESS = 'proxy-host:17322'
    const {context} = makeContext(tmpDir)

    await hook.call(context, makeOpts(tmpDir))
  })

  it('attempts interception using a config resolved from the config file', async () => {
    await writeFile(
      join(tmpDir, 'agent-proxy.json'),
      JSON.stringify({address: 'proxy-host:17322', caPath: join(tmpDir, 'absent.pem'), token: 'st.file'}),
      'utf8',
    )
    const {context, errorMessage} = makeContext(tmpDir)

    // No proxy is actually reachable and no CA was downloaded in the test
    // environment, so setup fails — but the failure proves the file-resolved
    // config drove the decision to intercept, and that it fails closed rather
    // than silently running unbrokered.
    const error = await hook.call(context, makeOpts(tmpDir)).catch((error_: unknown) => error_)

    expect(error).to.be.instanceOf(Error)
    expect(errorMessage()).to.match(/Could not read the Agent Proxy root CA/)
    expect(errorMessage()).to.match(/command was not run/)
    expect(errorMessage()).to.match(/SDKCK_AGENT_PROXY_DISABLED=1/)
  })

  it('prefers an environment-supplied CA path over the config file', async () => {
    await writeFile(
      join(tmpDir, 'agent-proxy.json'),
      JSON.stringify({address: 'proxy-host:17322', caPath: join(tmpDir, 'from-file.pem'), token: 'st.file'}),
      'utf8',
    )
    process.env.INFISICAL_AGENT_PROXY_CA = join(tmpDir, 'from-env.pem')
    const {context, errorMessage} = makeContext(tmpDir)

    await hook.call(context, makeOpts(tmpDir)).catch((error_: unknown) => error_)

    expect(errorMessage()).to.match(/from-env\.pem/)
  })

  it('does not attempt interception when disabled, even with a complete file config', async () => {
    await writeFile(
      join(tmpDir, 'agent-proxy.json'),
      JSON.stringify({address: 'proxy-host:17322', token: 'st.file'}),
      'utf8',
    )
    process.env.SDKCK_AGENT_PROXY_DISABLED = '1'
    const {context} = makeContext(tmpDir)

    await hook.call(context, makeOpts(tmpDir))
  })

  // A malformed file must never surface as a broken disable/child bypass —
  // those checks are meant to run unconditionally, before the file is ever
  // touched.
  it('honors SDKCK_AGENT_PROXY_DISABLED without reading the config file at all', async () => {
    await writeFile(join(tmpDir, 'agent-proxy.json'), '{not json', 'utf8')
    process.env.SDKCK_AGENT_PROXY_DISABLED = '1'
    const {context} = makeContext(tmpDir)

    await hook.call(context, makeOpts(tmpDir))
  })

  it('honors the re-executed-child sentinel without reading the config file at all', async () => {
    await writeFile(join(tmpDir, 'agent-proxy.json'), '{not json', 'utf8')
    process.env.SDKCK_AGENT_PROXY_ACTIVE = '1'
    const {context} = makeContext(tmpDir)

    await hook.call(context, makeOpts(tmpDir))
  })
})
