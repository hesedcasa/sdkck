import {hasLocale, NextIntlClientProvider} from 'next-intl'
import {setRequestLocale} from 'next-intl/server'
import {Geist_Mono, Inter} from 'next/font/google'
import {notFound} from 'next/navigation'

import {DocsMobileNav} from '@/components/docs-mobile-nav'
import {DocsSidebar} from '@/components/docs-sidebar'
import {Header} from '@/components/header'
import {ThemeProvider} from '@/components/theme-provider'
import {htmlLang, routing} from '@/i18n/routing'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
})

export function generateStaticParams() {
  return routing.locales.map((locale) => ({locale}))
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode
  params: Promise<{locale: string}>
}>) {
  const {locale} = await params
  if (!hasLocale(routing.locales, locale)) {
    notFound()
  }

  // Enable static rendering for this locale.
  setRequestLocale(locale)

  return (
    <html lang={htmlLang[locale] ?? locale} suppressHydrationWarning>
      <body
        className={`${inter.variable} ${geistMono.variable} bg-white text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100`}
      >
        <NextIntlClientProvider>
          <ThemeProvider>
            <Header />
            <DocsMobileNav />
            <div className="max-w-5xl mx-auto px-6 py-8 lg:py-12 flex gap-16">
              <aside className="w-52 shrink-0 hidden lg:block sticky top-20 h-[calc(100vh-5rem)] overflow-y-auto">
                <DocsSidebar />
              </aside>
              <div className="flex-1 min-w-0 max-w-3xl pb-20">
                <article className="prose">{children}</article>
              </div>
            </div>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
