import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {decryptString, loadOrCreateKey} from '../../../src/config-crypto.js'
import ApiEncrypt from '../../../src/commands/api/encrypt.js'

function makeEncrypt(argv: string[], configDir: string): {cmd: ApiEncrypt; output: () => string} {
  const lines: string[] = []
  const config = {
    bin: 'sdkck',
    configDir,
    runHook: async () => ({failures: [], successes: []}),
  } as never

  const cmd = new ApiEncrypt(argv, config)
  cmd.log = (message = '') => {
    lines.push(String(message))
  }

  return {cmd, output: () => lines.join('\n')}
}

describe('api encrypt', () => {
  let tmpDir: string
  let configDir: string

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-encrypt-test-'))
    configDir = join(tmpDir, 'config')
  })

  after(async () => {
    await rm(tmpDir, {recursive: true})
  })

  it('outputs a string prefixed with ENCV1:', async () => {
    const {cmd, output} = makeEncrypt(['hello world'], configDir)
    await cmd.run()
    expect(output()).to.match(/^ENCV1:/)
  })

  it('produces output that decrypts back to the original plaintext', async () => {
    const {cmd, output} = makeEncrypt(['my secret value'], configDir)
    await cmd.run()
    const key = loadOrCreateKey(configDir)
    expect(decryptString(output(), key)).to.equal('my secret value')
  })

  it('produces different ciphertext each call for the same input', async () => {
    const {cmd: cmd1, output: out1} = makeEncrypt(['same'], configDir)
    const {cmd: cmd2, output: out2} = makeEncrypt(['same'], configDir)
    await cmd1.run()
    await cmd2.run()
    expect(out1()).to.not.equal(out2())
  })
})
