import {createNavigation} from 'next-intl/navigation'

import {routing} from './routing'

// Locale-aware navigation APIs. `Link` and `useRouter` automatically add the
// active locale prefix (and Next.js adds basePath), so hrefs stay locale-
// agnostic throughout the app (e.g. '/installation', not '/en/installation').
export const {Link, getPathname, redirect, usePathname, useRouter} = createNavigation(routing)
