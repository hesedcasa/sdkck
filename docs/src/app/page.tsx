import {redirect} from 'next/navigation'

import {routing} from '@/i18n/routing'

// Static export has no middleware, so the locale-less root path redirects to
// the default locale here. Next.js emits a static redirect for this at export.
export default function RootPage() {
  redirect(`/${routing.defaultLocale}`)
}
