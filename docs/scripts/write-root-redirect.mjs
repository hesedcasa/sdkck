#!/usr/bin/env node
// Overwrites out/index.html (the locale-less landing page) with a static,
// self-contained redirect. Static export has no middleware, and Next's own
// redirect() output for a static host is a runtime stub that ignores basePath,
// so we emit a plain HTML redirect instead: it picks the best locale from the
// browser's languages and falls back to the default locale (and to a plain
// meta-refresh when JS is disabled). basePath and the locale list are read from
// the project config so this stays correct as languages are added.
import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outIndex = resolve(__dirname, '../out/index.html')

const nextConfig = readFileSync(resolve(__dirname, '../next.config.mjs'), 'utf8')
const routing = readFileSync(resolve(__dirname, '../src/i18n/routing.ts'), 'utf8')

const basePath = (nextConfig.match(/basePath:\s*['"]([^'"]*)['"]/) ?? [, ''])[1]
const defaultLocale = (routing.match(/defaultLocale:\s*['"]([^'"]+)['"]/) ?? [, 'en'])[1]
const localesMatch = routing.match(/locales:\s*\[([^\]]*)\]/)
const locales = localesMatch
  ? localesMatch[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean)
  : [defaultLocale]

const fallback = `${basePath}/${defaultLocale}/`

const html = `<!doctype html>
<html lang="${defaultLocale}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <meta http-equiv="refresh" content="0; url=${fallback}" />
    <title>Sidekick</title>
    <script>
      (function () {
        var base = ${JSON.stringify(basePath)};
        var locales = ${JSON.stringify(locales)};
        var def = ${JSON.stringify(defaultLocale)};
        var prefs = navigator.languages || [navigator.language || def];
        var target = def;
        outer: for (var i = 0; i < prefs.length; i++) {
          var lang = String(prefs[i]).toLowerCase();
          var primary = lang.split('-')[0];
          for (var j = 0; j < locales.length; j++) {
            var loc = locales[j].toLowerCase();
            if (lang === loc || lang.indexOf(loc + '-') === 0 || loc.split('-')[0] === primary) {
              target = locales[j];
              break outer;
            }
          }
        }
        window.location.replace(base + '/' + target + '/');
      })();
    </script>
  </head>
  <body>
    <p>Redirecting to <a href="${fallback}">the documentation</a>&hellip;</p>
  </body>
</html>
`

if (!existsSync(outIndex)) {
  console.warn(`root-redirect: ${outIndex} not found (run after \`next build\`); skipping`)
  process.exit(0)
}

writeFileSync(outIndex, html)
console.log(`root-redirect: wrote ${outIndex} → ${fallback} (locales: ${locales.join(', ')})`)
