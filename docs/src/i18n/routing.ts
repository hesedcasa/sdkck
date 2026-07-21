import {defineRouting} from 'next-intl/routing'

// To add a new language in the future:
//   1. Add its code to `locales` below and give it a label in `localeLabels`.
//   2. Create messages/<code>.json (UI strings).
//   3. Add translated MDX under src/content/<code>/ (mirroring src/content/en/).
// Everything else — routing, the language switcher, static export — picks it up
// automatically.
export const routing = defineRouting({
  defaultLocale: 'en',
  localePrefix: 'always',
  locales: ['en', 'zh'],
})

export type Locale = (typeof routing.locales)[number]

// Endonyms shown in the language switcher (same in any UI language).
export const localeLabels: Record<string, string> = {
  en: 'English',
  zh: '中文',
}

// BCP-47 tag applied to <html lang>.
export const htmlLang: Record<string, string> = {
  en: 'en',
  zh: 'zh-Hans',
}
