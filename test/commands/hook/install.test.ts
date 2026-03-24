import {expect} from 'chai'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import HookInstall from '../../../src/commands/hook/install.js'

function makeInstall(
  argv: string[],
  tmpDir: string,
): {cmd: HookInstall; output: () => string; warnings: () => string} {
  const lines: string[] = []
  const warns: string[] = []
  const config = {
    bin: 'sdkck',
    configDir: tmpDir,
    runHook: async () => ({failures: [], successes: []}),
  } as never
  const cmd = new HookInstall(argv, config)
  cmd.log = (message = '') => {
    lines.push(String(message))
  }
  cmd.warn = (message: Error | string) => {
    warns.push(String(message))
    return String(message)
  }

  return {cmd, output: () => lines.join('\n'), warnings: () => warns.join('\n')}
}

describe('hook install', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-hook-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, {recursive: true})
  })

  it('writes the hook script and creates settings.json', async () => {
    const hooksDir = join(tmpDir, 'hooks')
    const settingsPath = join(tmpDir, 'settings.json')

    const {cmd, output} = makeInstall(['--hooks-dir', hooksDir, '--settings', settingsPath], tmpDir)
    await cmd.run()

    const out = output()
    expect(out).to.contain('Hook script written to')
    expect(out).to.contain('Registered in')
    expect(out).to.contain('sdkck hook installed')

    const script = await readFile(join(hooksDir, 'sdkck-hook.sh'), 'utf8')
    expect(script).to.contain('#!/usr/bin/env bash')
    expect(script).to.contain('PreToolUse')

    const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(settings.hooks.PreToolUse).to.have.length(1)
    expect(settings.hooks.PreToolUse[0].matcher).to.equal('Bash')
    expect(settings.hooks.PreToolUse[0].hooks[0].type).to.equal('command')
    expect(settings.hooks.PreToolUse[0].hooks[0].command).to.contain('sdkck-hook.sh')
  })

  it('reports already registered when hook is present and --force not set', async () => {
    const hooksDir = join(tmpDir, 'hooks')
    const settingsPath = join(tmpDir, 'settings.json')
    const argv = ['--hooks-dir', hooksDir, '--settings', settingsPath]

    // First install
    await makeInstall(argv, tmpDir).cmd.run()

    // Second install without --force
    const {cmd, output} = makeInstall(argv, tmpDir)
    await cmd.run()

    expect(output()).to.contain('already registered')

    // Settings should still have exactly one entry
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(settings.hooks.PreToolUse).to.have.length(1)
  })

  it('replaces existing hook entry when --force is used', async () => {
    const hooksDir = join(tmpDir, 'hooks')
    const settingsPath = join(tmpDir, 'settings.json')
    const argv = ['--hooks-dir', hooksDir, '--settings', settingsPath]

    await makeInstall(argv, tmpDir).cmd.run()
    await makeInstall([...argv, '--force'], tmpDir).cmd.run()

    const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(settings.hooks.PreToolUse).to.have.length(1)
  })

  it('merges into an existing settings.json without clobbering other entries', async () => {
    const hooksDir = join(tmpDir, 'hooks')
    const settingsPath = join(tmpDir, 'settings.json')

    const existing = {
      hooks: {
        PostToolUse: [{hooks: [{command: '/some/other-hook.sh', type: 'command'}], matcher: 'Write'}],
      },
      someOtherSetting: true,
    }
    await rm(settingsPath, {force: true})
    const {writeFile} = await import('node:fs/promises')
    await writeFile(settingsPath, JSON.stringify(existing, null, 2), 'utf8')

    const {cmd} = makeInstall(['--hooks-dir', hooksDir, '--settings', settingsPath], tmpDir)
    await cmd.run()

    const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(settings.someOtherSetting).to.equal(true)
    expect(settings.hooks.PostToolUse).to.have.length(1)
    expect(settings.hooks.PreToolUse).to.have.length(1)
  })
})
