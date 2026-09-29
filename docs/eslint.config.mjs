import {includeIgnoreFile} from '@eslint/compat'
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// eslint-config-next v16 exports flat configs directly, so they are spread in
// instead of being adapted from the legacy eslintrc format via FlatCompat.
const eslintConfig = [
  includeIgnoreFile(join(__dirname, '.gitignore')),
  ...nextCoreWebVitals,
  ...nextTypescript,
]

export default eslintConfig
