import {includeIgnoreFile} from '@eslint/compat'
import oclif from 'eslint-config-oclif'
import prettier from 'eslint-config-prettier'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const gitignorePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.gitignore')

export default [
  includeIgnoreFile(gitignorePath),
  {
    ignores: ['docs/**'],
  },
  ...oclif,
  {
    // The Agent Vault SDK is built on the global fetch/Response/Headers trio.
    // package.json still declares engines >=18, where the rule considers them
    // experimental, but the CLI targets Node 22 (.nvmrc) and CI runs 22-24.
    files: [
      'src/agent-vault/**/*.ts',
      'src/agent-vault-process.ts',
      'src/hooks/init/setup-agent-vault.ts',
      'test/agent-vault/**/*.ts',
      'test/agent-vault-process.test.ts',
    ],
    rules: {
      'n/no-unsupported-features/node-builtins': 'off',
    },
  },
  prettier,
]
