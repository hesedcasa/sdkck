import {includeIgnoreFile} from '@eslint/compat'
import next from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// eslint-config-next v16 ships native flat configs, so we spread them directly
// instead of bridging the legacy `.eslintrc` format via FlatCompat.
const eslintConfig = [includeIgnoreFile(join(__dirname, '.gitignore')), ...next, ...nextTypescript]

export default eslintConfig
