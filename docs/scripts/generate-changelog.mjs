#!/usr/bin/env node
// Regenerates docs/src/app/changelog/page.mdx (and the Mandarin variant at
// docs/src/app/zh/changelog/page.mdx) from the project CHANGELOG.md so the
// changelog page always reflects the source of truth maintained by
// release-please. The release notes themselves stay in English for both
// locales — only a Mandarin heading and note are prepended to the zh page.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = resolve(__dirname, '../../CHANGELOG.md')
const target = resolve(__dirname, '../src/app/changelog/page.mdx')
const zhTarget = resolve(__dirname, '../src/app/zh/changelog/page.mdx')

const content = readFileSync(source, 'utf8')

mkdirSync(dirname(target), {recursive: true})
writeFileSync(target, content)
console.log(`changelog: wrote ${target} from ${source}`)

// Mandarin changelog: same release notes (auto-generated, English), with a
// localized heading and a note explaining they are kept in English.
const zhHeader =
  '# 更新日志\n\n' +
  '> 以下发行说明由 [release-please](https://github.com/googleapis/release-please) 自动生成，保持英文原文。\n\n'
const zhBody = content.replace(/^#\s+Changelog\s*\n+/, '')

mkdirSync(dirname(zhTarget), {recursive: true})
writeFileSync(zhTarget, zhHeader + zhBody)
console.log(`changelog: wrote ${zhTarget} from ${source}`)
