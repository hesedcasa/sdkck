import {expect} from 'chai'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {AgentVaultError} from '../../src/agent-vault/errors.js'
import {readAgentVaultFileConfig, resolveConfigDir} from '../../src/agent-vault/index.js'

describe('agent-vault config file', () => {
  describe('resolveConfigDir', () => {
    it('prefers SDKCK_CONFIG_DIR when set', () => {
      expect(resolveConfigDir({SDKCK_CONFIG_DIR: '/custom/dir'})).to.equal('/custom/dir')
    })

    it('falls back to XDG_CONFIG_HOME, joined with the CLI dirname', () => {
      expect(resolveConfigDir({XDG_CONFIG_HOME: '/xdg'})).to.equal(join('/xdg', 'sdkck'))
    })

    it('falls back to ~/.config when nothing else is set', () => {
      const home = '/home/someone'
      expect(resolveConfigDir({HOME: home})).to.equal(join(home, '.config', 'sdkck'))
    })
  })

  describe('readAgentVaultFileConfig', () => {
    let tmpDir: string

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'sdkck-agent-vault-config-'))
    })

    afterEach(async () => {
      await rm(tmpDir, {force: true, recursive: true})
    })

    it('resolves to {} when the file does not exist', () => {
      expect(readAgentVaultFileConfig(tmpDir)).to.deep.equal({})
    })

    it('reads token, address and vault from the file', async () => {
      await writeFile(
        join(tmpDir, 'agent-vault.json'),
        JSON.stringify({address: 'http://localhost:14321', token: 'av_agt_file', vault: 'my-project'}),
        'utf8',
      )

      expect(readAgentVaultFileConfig(tmpDir)).to.deep.equal({
        address: 'http://localhost:14321',
        token: 'av_agt_file',
        vault: 'my-project',
      })
    })

    it('reads noProxy from the file', async () => {
      await writeFile(
        join(tmpDir, 'agent-vault.json'),
        JSON.stringify({noProxy: '10.40.1.11,*.internal', token: 'av_agt_file', vault: 'my-project'}),
        'utf8',
      )

      expect(readAgentVaultFileConfig(tmpDir)).to.deep.equal({
        noProxy: '10.40.1.11,*.internal',
        token: 'av_agt_file',
        vault: 'my-project',
      })
    })

    it('reads the platform fields from the file', async () => {
      await writeFile(
        join(tmpDir, 'agent-vault.json'),
        JSON.stringify({
          caFingerprint: 'SHA256:ABCD',
          proxy: 'proxy.internal:17323',
          sessionToken: 'agv_file',
        }),
        'utf8',
      )

      expect(readAgentVaultFileConfig(tmpDir)).to.deep.equal({
        caFingerprint: 'SHA256:ABCD',
        proxy: 'proxy.internal:17323',
        sessionToken: 'agv_file',
      })
    })

    it('throws when a platform field is not a string', async () => {
      await writeFile(join(tmpDir, 'agent-vault.json'), JSON.stringify({proxy: 17_323}), 'utf8')

      expect(() => readAgentVaultFileConfig(tmpDir)).to.throw(AgentVaultError, /"proxy" must be a string/)
    })

    it('ignores fields that are absent from the file', async () => {
      await writeFile(join(tmpDir, 'agent-vault.json'), JSON.stringify({token: 'av_agt_file'}), 'utf8')

      expect(readAgentVaultFileConfig(tmpDir)).to.deep.equal({token: 'av_agt_file'})
    })

    it('throws AgentVaultError when the file is not valid JSON', async () => {
      await writeFile(join(tmpDir, 'agent-vault.json'), '{not json', 'utf8')

      expect(() => readAgentVaultFileConfig(tmpDir)).to.throw(AgentVaultError, /Could not parse/)
    })

    it('throws AgentVaultError when the file is a JSON array', async () => {
      await writeFile(join(tmpDir, 'agent-vault.json'), '[]', 'utf8')

      expect(() => readAgentVaultFileConfig(tmpDir)).to.throw(AgentVaultError, /must contain a JSON object/)
    })

    it('throws AgentVaultError when a field is not a string', async () => {
      await writeFile(join(tmpDir, 'agent-vault.json'), JSON.stringify({token: 123}), 'utf8')

      expect(() => readAgentVaultFileConfig(tmpDir)).to.throw(AgentVaultError, /"token" must be a string/)
    })
  })
})
