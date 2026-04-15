#!/usr/bin/env node
// Regenerates docs/src/app/changelog/page.mdx from the project CHANGELOG.md
// so the changelog page always reflects the source of truth maintained by
// release-please.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = resolve(__dirname, '../../CHANGELOG.md')
const target = resolve(__dirname, '../src/app/changelog/page.mdx')

const content = readFileSync(source, 'utf8')

mkdirSync(dirname(target), {recursive: true})
writeFileSync(target, content)

console.log(`changelog: wrote ${target} from ${source}`)
