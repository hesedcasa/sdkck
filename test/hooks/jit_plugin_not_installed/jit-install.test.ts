import {Errors} from '@oclif/core'
import {expect} from 'chai'

import hook from '../../../src/hooks/jit_plugin_not_installed/jit-install.js'

type HookOpts = Parameters<typeof hook>[0]

function makeOpts(runCommand: (cmd: string, args: string[]) => Promise<void>, pluginName: string): HookOpts {
  return {
    argv: [],
    command: {pluginName} as HookOpts['command'],
    config: {runCommand} as unknown as HookOpts['config'],
    context: {} as HookOpts['context'],
    id: pluginName,
    pluginName,
    pluginVersion: '^0.2.0',
  }
}

describe('jit_plugin_not_installed hook', () => {
  it('calls plugins:install with pluginName@pluginVersion', async () => {
    const calls: Array<[string, string[]]> = []

    await hook.call(
      {} as never,
      makeOpts(async (cmd, args) => {
        calls.push([cmd, args])
      }, '@hesed/jira'),
    )

    expect(calls).to.deep.equal([['plugins:install', ['@hesed/jira@^0.2.0']]])
  })

  it('throws CLIError with plugin name when installation fails', async () => {
    try {
      await hook.call(
        {} as never,
        makeOpts(async () => {
          throw new Error('network error')
        }, '@hesed/jira'),
      )
      expect.fail('should have thrown a CLIError')
    } catch (error: unknown) {
      expect(error).to.be.instanceOf(Errors.CLIError)
      expect((error as Errors.CLIError).message).to.equal('Could not install @hesed/jira: network error')
    }
  })

  it('handles non-Error rejections in CLIError message', async () => {
    try {
      await hook.call(
        {} as never,
        makeOpts(async () => {
          throw 'unexpected string error'
        }, '@hesed/bb'),
      )
      expect.fail('should have thrown a CLIError')
    } catch (error: unknown) {
      expect(error).to.be.instanceOf(Errors.CLIError)
      expect((error as Errors.CLIError).message).to.equal('Could not install @hesed/bb: unexpected string error')
    }
  })
})
