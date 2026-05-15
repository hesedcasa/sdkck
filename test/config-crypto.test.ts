import {expect} from 'chai'
import {randomBytes} from 'node:crypto'
import {readFileSync, writeFileSync} from 'node:fs'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {
  decryptFile,
  decryptString,
  encryptFile,
  encryptString,
  loadOrCreateKey,
} from '../src/config-crypto.js'

describe('config-crypto', () => {
  let tmpDir: string
  let key: Buffer

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-crypto-'))
    key = randomBytes(32)
  })

  afterEach(async () => {
    await rm(tmpDir, {recursive: true})
  })

  // ─── loadOrCreateKey ────────────────────────────────────────────────────────

  describe('loadOrCreateKey', () => {
    it('creates a 32-byte key file on first call', () => {
      const k = loadOrCreateKey(tmpDir)
      expect(k).to.be.instanceOf(Buffer)
      expect(k.length).to.equal(32)
    })

    it('returns the same key on subsequent calls', () => {
      const k1 = loadOrCreateKey(tmpDir)
      const k2 = loadOrCreateKey(tmpDir)
      expect(k1.equals(k2)).to.be.true
    })
  })

  // ─── encryptString / decryptString ──────────────────────────────────────────

  describe('encryptString / decryptString', () => {
    it('round-trips a plaintext string', () => {
      const plain = 'hello world'
      const enc = encryptString(plain, key)
      expect(enc.startsWith('ENCV1:')).to.be.true
      expect(decryptString(enc, key)).to.equal(plain)
    })

    it('produces different ciphertext each call (random IV)', () => {
      const enc1 = encryptString('same', key)
      const enc2 = encryptString('same', key)
      expect(enc1).to.not.equal(enc2)
    })

    it('returns unencrypted strings as-is for backward compat', () => {
      expect(decryptString('{"plain":true}', key)).to.equal('{"plain":true}')
    })
  })

  // ─── encryptFile / decryptFile ───────────────────────────────────────────────

  describe('encryptFile / decryptFile', () => {
    it('round-trips a text file', async () => {
      const src = join(tmpDir, 'plain.txt')
      const enc = join(tmpDir, 'plain.enc')
      const dec = join(tmpDir, 'plain.dec')
      await writeFile(src, 'secret content')
      encryptFile(src, enc, key)
      decryptFile(enc, dec, key)
      expect(readFileSync(dec, 'utf8')).to.equal('secret content')
    })

    it('round-trips a binary file', async () => {
      const src = join(tmpDir, 'bin.dat')
      const enc = join(tmpDir, 'bin.enc')
      const dec = join(tmpDir, 'bin.dec')
      const bytes = randomBytes(256)
      await writeFile(src, bytes)
      encryptFile(src, enc, key)
      decryptFile(enc, dec, key)
      expect(readFileSync(dec).equals(bytes)).to.be.true
    })

    it('encrypted file starts with ENCV1 binary magic', async () => {
      const src = join(tmpDir, 'f.txt')
      const enc = join(tmpDir, 'f.enc')
      await writeFile(src, 'data')
      encryptFile(src, enc, key)
      const header = readFileSync(enc).subarray(0, 5).toString('ascii')
      expect(header).to.equal('ENCV1')
    })

    it('supports in-place encryption then decryption', async () => {
      const path = join(tmpDir, 'inplace.txt')
      await writeFile(path, 'in-place text')
      encryptFile(path, path, key)
      decryptFile(path, path, key)
      expect(readFileSync(path, 'utf8')).to.equal('in-place text')
    })

    it('produces different ciphertext each call (random IV)', async () => {
      const src = join(tmpDir, 'same.txt')
      const enc1 = join(tmpDir, 'enc1')
      const enc2 = join(tmpDir, 'enc2')
      await writeFile(src, 'same content')
      encryptFile(src, enc1, key)
      encryptFile(src, enc2, key)
      expect(readFileSync(enc1).equals(readFileSync(enc2))).to.be.false
    })

    it('throws when decrypting a non-encrypted file', async () => {
      const plain = join(tmpDir, 'plain.bin')
      const out = join(tmpDir, 'out.bin')
      await writeFile(plain, 'not encrypted')
      expect(() => decryptFile(plain, out, key)).to.throw(/ENCV1/)
    })

    it('throws on tampered ciphertext (auth tag mismatch)', async () => {
      const src = join(tmpDir, 'tamper.txt')
      const enc = join(tmpDir, 'tamper.enc')
      const out = join(tmpDir, 'tamper.out')
      await writeFile(src, 'authentic')
      encryptFile(src, enc, key)
      const buf = readFileSync(enc)
      const last = buf.length - 1
      buf[last] = buf[last] === 0 ? 1 : 0
      writeFileSync(enc, buf)
      expect(() => decryptFile(enc, out, key)).to.throw()
    })
  })
})
