import {Args, Command} from '@oclif/core'

import {decryptString, loadOrCreateKey} from '../../config-crypto.js'

export default class ApiDecrypt extends Command {
  static args = {
    ciphertext: Args.string({
      description: 'Encrypted string to decrypt (must start with ENCV1:)',
      required: true,
    }),
  }
  static description = 'Decrypt a string that was encrypted with `api encrypt`'
  static examples = [
    '<%= config.bin %> api decrypt "ENCV1:..."',
    'VALUE=$(sdkck api encrypt "secret") && sdkck api decrypt "$VALUE"',
  ]

  async run(): Promise<void> {
    const {args} = await this.parse(ApiDecrypt)
    const key = loadOrCreateKey(this.config.configDir)
    this.log(decryptString(args.ciphertext, key))
  }
}
