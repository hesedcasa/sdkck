import type {MDXComponents} from 'mdx/types'

import Link from 'next/link'

import {CodeBlock} from '@/components/code-block'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/[^\w\s-]/g, '')
    .replaceAll(/\s+/g, '-')
    .trim()
}

function extractText(children: React.ReactNode): string {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(extractText).join('')
  if (children && typeof children === 'object') {
    const obj = children as unknown as Record<string, unknown>
    if ('props' in obj) {
      const props = obj.props as undefined | {children?: React.ReactNode}
      return extractText(props?.children)
    }
  }

  return ''
}

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,
    table({children, ...props}: React.ComponentPropsWithoutRef<'table'>) {
      return (
        <div className="table-wrapper">
          <table {...props}>{children}</table>
        </div>
      )
    },
    a({children, href}: {children?: React.ReactNode; href?: string}) {
      if (href?.startsWith('/')) {
        return <Link href={href}>{children}</Link>
      }

      return (
        <a href={href} rel="noopener noreferrer" target="_blank">
          {children}
        </a>
      )
    },
    code({children, className}: {children?: React.ReactNode; className?: string}) {
      if (className) {
        return <code className={className}>{children}</code>
      }

      return <code>{children}</code>
    },
    h1({children}: {children?: React.ReactNode}) {
      const id = slugify(extractText(children))
      return (
        <h1 className="heading-anchor" id={id}>
          {children}
          <a aria-label="Link to this section" href={`#${id}`}>
            #
          </a>
        </h1>
      )
    },
    h2({children}: {children?: React.ReactNode}) {
      const id = slugify(extractText(children))
      return (
        <h2 className="heading-anchor" id={id}>
          {children}
          <a aria-label="Link to this section" href={`#${id}`}>
            #
          </a>
        </h2>
      )
    },
    h3({children}: {children?: React.ReactNode}) {
      const id = slugify(extractText(children))
      return (
        <h3 className="heading-anchor" id={id}>
          {children}
          <a aria-label="Link to this section" href={`#${id}`}>
            #
          </a>
        </h3>
      )
    },
    async pre({children}: {children?: React.ReactNode}) {
      const codeElement = children as React.ReactElement<{
        children?: string
        className?: string
      }>
      const className = codeElement?.props?.className || ''
      const lang = className.replace('language-', '') || 'bash'
      const code = codeElement?.props?.children || ''
      return <CodeBlock code={typeof code === 'string' ? code : String(code)} lang={lang} />
    },
  }
}
