'use client'

import {useLocale} from 'next-intl'
import {useTransition} from 'react'

import {usePathname, useRouter} from '@/i18n/navigation'
import {localeLabels, routing} from '@/i18n/routing'

// Lists every configured locale, so adding a language to routing.ts makes it
// appear here automatically. Switching keeps the reader on the same page.
export function LocaleSwitcher() {
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function onSelect(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextLocale = event.target.value
    startTransition(() => {
      router.replace(pathname, {locale: nextLocale})
    })
  }

  return (
    <label className="relative flex items-center">
      <span className="sr-only">Language</span>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute left-2 h-4 w-4 text-neutral-500 dark:text-neutral-400"
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
      <select
        aria-label="Select language"
        className="appearance-none h-8 pl-8 pr-6 rounded-md bg-transparent text-sm text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 transition-colors cursor-pointer focus:outline-none dark:text-neutral-400 dark:hover:text-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50"
        disabled={isPending}
        onChange={onSelect}
        value={locale}
      >
        {routing.locales.map((code) => (
          <option key={code} value={code}>
            {localeLabels[code] ?? code}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute right-1.5 h-3 w-3 text-neutral-500 dark:text-neutral-400"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </label>
  )
}
