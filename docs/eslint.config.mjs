import {includeIgnoreFile} from '@eslint/compat'
import {FlatCompat} from '@eslint/eslintrc'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({
  baseDirectory: __dirname,
})

const eslintConfig = [
  includeIgnoreFile(join(__dirname, '.gitignore')),
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
]

export default eslintConfig
