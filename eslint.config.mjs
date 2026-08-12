import {includeIgnoreFile} from '@eslint/compat'
import oclif from 'eslint-config-oclif'
import prettier from 'eslint-config-prettier'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import tseslint from 'typescript-eslint'

const gitignorePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.gitignore')

const config = [
  includeIgnoreFile(gitignorePath),
  {
    ignores: ['coverage/', 'dist/', 'docs/**'],
  },
  ...oclif,
  // Disable type-checked (type-aware) rules for test files. Test fixtures and
  // mocks don't need full type information and shouldn't fail type-aware rules
  // such as no-unsafe-* / no-base-to-string. Tests are also excluded from
  // tsconfig.json, so the type-aware parser has no project to resolve them in.
  {
    files: ['test/**/*.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
  // eslint.config.mjs references non-camel-case option names from
  // typescript-eslint's API. typescript-eslint is a transitive dependency (via
  // eslint-config-oclif), so it isn't listed directly — relax the
  // extraneous-dependency checks for this file only.
  {
    files: ['eslint.config.mjs'],
    rules: {
      camelcase: 'off',
      'import-x/no-extraneous-dependencies': 'off',
      'n/no-extraneous-import': 'off',
    },
  },
  // Relax overly-strict rules from eslint-config-oclif@7 across the project.
  {
    rules: {
      // Agent Vault's control plane and the OTel SDK both distinguish null from
      // undefined (a null MITM info means "MITM is off"), so `null` in a type
      // position is deliberate here.
      '@typescript-eslint/no-restricted-types': 'off',
      // Named imports from `node:path` (`{join, dirname}`) are the convention
      // throughout this codebase; the rule wants a default `path` import.
      'unicorn/import-style': 'off',
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      'perfectionist/sort-classes': 'off',
      'require-unicode-regexp': 'off',
      'unicorn/consistent-class-member-order': 'off',
      'unicorn/no-computed-property-existence-check': 'off',
    },
  },
  // oclif dispatches hooks with a loosely-typed `this`/`opts` and wraps oclif
  // internals (`Config.runCommand`, `Command.prototype.warn`), so the hooks
  // unavoidably reach through `any`.
  {
    files: ['src/hooks/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  // `jit_plugin_not_installed` is an oclif hook event name, which is snake_case
  // by oclif's own convention — the directory has to match it.
  {
    files: ['**/jit_plugin_not_installed/*.ts'],
    rules: {
      'unicorn/filename-case': 'off',
    },
  },
  // Additional relaxations for test files only. These are pure style rules that
  // conflict with common test patterns (mock stubs, mock-tracking booleans,
  // hand-built fetch responses and env-var manipulation).
  {
    files: ['test/**/*.ts'],
    rules: {
      '@eslint-community/eslint-comments/require-description': 'off',
      '@typescript-eslint/consistent-type-assertions': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      'require-unicode-regexp': 'off',
      'unicorn/consistent-boolean-name': 'off',
      'unicorn/no-computed-property-existence-check': 'off',
      'unicorn/no-non-function-verb-prefix': 'off',
      'unicorn/prefer-https': 'off',
      'unicorn/prefer-response-static-json': 'off',
    },
  },
  {
    // The Agent Vault SDK is built on the global fetch/Response/Headers trio,
    // which the rule still considers experimental on the oldest supported
    // release. package.json requires Node >=22 and CI runs 22-24.
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

export default config
