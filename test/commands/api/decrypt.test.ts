import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {encryptString, loadOrCreateKey} from '../../../src/config-crypto.js'
import ApiDecrypt from '../../../src/commands/api/decrypt.js'

function makeDecrypt(argv: string[], configDir: string): {cmd: ApiDecrypt; output: () => string} {
  const lines: string[] = []
  const config = {
    bin: 'sdkck',
    configDir,
    runHook: async () => ({failures: [], successes: []}),
  } as never

  const cmd = new ApiDecrypt(argv, config)
  cmd.log = (message = '') => {
    lines.push(String(message))
  }

  return {cmd, output: () => lines.join('\n')}
}

describe('api decrypt', () => {
  let tmpDir: string
  let configDir: string
  let key: Buffer

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-decrypt-test-'))
    configDir = join(tmpDir, 'config')
    key = loadOrCreateKey(configDir)
  })

  after(async () => {
    await rm(tmpDir, {recursive: true})
  })

  it('decrypts a value encrypted with the same key', async () => {
    const ciphertext = encryptString('hello world', key)
    const {cmd, output} = makeDecrypt([ciphertext], configDir)
    await cmd.run()
    expect(output()).to.equal('hello world')
  })

  it('returns plain text as-is when not prefixed with ENCV1:', async () => {
    const {cmd, output} = makeDecrypt(['not-encrypted'], configDir)
    await cmd.run()
    expect(output()).to.equal('not-encrypted')
  })

  it('round-trips arbitrary values', async () => {
    const original = JSON.stringify({token: 'sk-abc123', expires: 9999})
    const ciphertext = encryptString(original, key)
    const {cmd, output} = makeDecrypt([ciphertext], configDir)
    await cmd.run()
    expect(output()).to.equal(original)
  })
})
