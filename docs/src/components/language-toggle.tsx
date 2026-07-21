'use client'

import Link from 'next/link'
import {usePathname} from 'next/navigation'

import {localeFromPathname, pathForLocale} from '@/lib/docs-navigation'

export function LanguageToggle() {
  const pathname = usePathname()
  const locale = localeFromPathname(pathname)
  const target = locale === 'zh' ? 'en' : 'zh'
  const label = target === 'zh' ? '中文' : 'EN'
  const ariaLabel = target === 'zh' ? '切换到中文' : 'Switch to English'

  return (
    <Link
      aria-label={ariaLabel}
      className="flex items-center gap-1.5 h-8 px-2.5 rounded-md text-sm text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 transition-colors dark:text-neutral-400 dark:hover:text-neutral-100 dark:hover:bg-neutral-800"
      href={pathForLocale(pathname, target)}
    >
      <svg
        aria-hidden="true"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
      <span>{label}</span>
    </Link>
  )
}
