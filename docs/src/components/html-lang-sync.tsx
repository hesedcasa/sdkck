'use client'

import {usePathname} from 'next/navigation'
import {useEffect} from 'react'

import {localeFromPathname} from '@/lib/docs-navigation'

// Keeps <html lang> in sync with the active locale. The root layout is shared
// across locales in this statically-exported app, so the lang attribute is
// updated on the client whenever the path (and thus locale) changes.
export function HtmlLangSync() {
  const pathname = usePathname()

  useEffect(() => {
    const locale = localeFromPathname(pathname)
    document.documentElement.lang = locale === 'zh' ? 'zh-Hans' : 'en'
  }, [pathname])

  return null
}
