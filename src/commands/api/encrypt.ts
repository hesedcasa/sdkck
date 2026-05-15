import {Args, Command} from '@oclif/core'

import {encryptString, loadOrCreateKey} from '../../config-crypto.js'

export default class ApiEncrypt extends Command {
  static args = {
    plaintext: Args.string({
      description: 'Text to encrypt',
      required: true,
    }),
  }
  static description = 'Encrypt a string using the local config key (AES-256-GCM)'
  static examples = [
    '<%= config.bin %> api encrypt "my secret value"',
    '<%= config.bin %> api encrypt "sk-abc123"',
  ]

  async run(): Promise<void> {
    const {args} = await this.parse(ApiEncrypt)
    const key = loadOrCreateKey(this.config.configDir)
    this.log(encryptString(args.plaintext, key))
  }
}
