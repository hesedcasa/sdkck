'use client'

import Link from 'next/link'
import {usePathname} from 'next/navigation'
import {useEffect, useMemo, useState} from 'react'

import {allDocsPages, navigation} from '@/lib/docs-navigation'
import {cn} from '@/lib/utils'

export function DocsMobileNav() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  const currentPage = useMemo(() => {
    const page = allDocsPages.find((p) => p.href === pathname)
    return page ?? allDocsPages[0]
  }, [pathname])

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <>
      <button
        className="lg:hidden sticky top-14 z-40 w-full px-6 py-3 bg-background/80 backdrop-blur-sm border-b border-border flex items-center justify-between focus:outline-none"
        onClick={() => setOpen(true)}
      >
        <span className="text-sm font-medium">{currentPage?.name}</span>
        <span className="w-8 h-8 flex items-center justify-center">
          <svg
            className="text-muted-foreground"
            fill="none"
            height="16"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="16"
          >
            <line x1="8" x2="21" y1="6" y2="6" />
            <line x1="8" x2="21" y1="12" y2="12" />
            <line x1="8" x2="21" y1="18" y2="18" />
            <line x1="3" x2="3.01" y1="6" y2="6" />
            <line x1="3" x2="3.01" y1="12" y2="12" />
            <line x1="3" x2="3.01" y1="18" y2="18" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 lg:hidden" onClick={() => setOpen(false)}>
          <aside
            className="fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-background shadow-xl overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-sm font-semibold">Table of Contents</h2>
              <button
                aria-label="Close menu"
                className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                onClick={() => setOpen(false)}
              >
                <svg
                  fill="none"
                  height="16"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  width="16"
                >
                  <line x1="18" x2="6" y1="6" y2="18" />
                  <line x1="6" x2="18" y1="6" y2="18" />
                </svg>
              </button>
            </div>
            <nav className="space-y-6">
              {navigation.map((section, sectionIndex) => (
                <div key={section.title ?? sectionIndex}>
                  {section.title && (
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                      {section.title}
                    </h4>
                  )}
                  <ul className="space-y-1">
                    {section.items.map((item) => (
                      <li key={item.href}>
                        <Link
                          className={cn(
                            'text-sm block py-2 transition-colors',
                            pathname === item.href
                              ? 'text-primary font-medium'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                          href={item.href}
                        >
                          {item.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </aside>
        </div>
      )}
    </>
  )
}
