import {setRequestLocale} from 'next-intl/server'
import {notFound} from 'next/navigation'

import {contentParams, registry} from '@/content/registry'

export function generateStaticParams() {
  return contentParams
}

// Static export needs every param combination known ahead of time.
export const dynamicParams = false

export default async function DocPage({
  params,
}: {
  params: Promise<{locale: string; slug?: string[]}>
}) {
  const {locale, slug} = await params
  setRequestLocale(locale)

  const key = (slug ?? []).join('/')
  const Content = registry[locale]?.[key]

  if (!Content) {
    notFound()
  }

  return <Content />
}
