'use client'

import {useTranslations} from 'next-intl'

import {Link, usePathname} from '@/i18n/navigation'
import {navigation} from '@/lib/docs-navigation'
import {cn} from '@/lib/utils'

export function DocsSidebar() {
  const pathname = usePathname()
  const tItems = useTranslations('nav.items')
  const tSections = useTranslations('nav.sections')

  return (
    <nav className="space-y-6 pb-8">
      {navigation.map((section, sectionIndex) => (
        <div key={section.titleKey ?? sectionIndex}>
          {section.titleKey && (
            <h4 className="text-xs font-normal text-muted-foreground/50 uppercase tracking-wider mb-2">
              {tSections(section.titleKey)}
            </h4>
          )}
          <ul className="space-y-1">
            {section.items.map((item) => {
              const isActive = pathname === item.href
              return (
                <li key={item.href}>
                  <Link
                    className={cn(
                      'text-sm transition-colors block py-1',
                      isActive ? 'text-primary font-medium' : 'text-muted-foreground hover:text-foreground',
                    )}
                    href={item.href}
                  >
                    {tItems(item.key)}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
