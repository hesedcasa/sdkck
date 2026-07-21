import type {MDXComponents} from 'mdx/types'

import {CodeBlock} from '@/components/code-block'
import {Link} from '@/i18n/navigation'

const BASE_PATH = '/sdkck'

function withBasePath(path?: string): string | undefined {
  if (!path) return path
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
    return path
  }

  if (path.startsWith(BASE_PATH) || !path.startsWith('/')) {
    return path
  }

  return `${BASE_PATH}${path}`
}

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
    img({alt, src, ...props}: React.ComponentPropsWithoutRef<'img'>) {
      const resolvedSrc = typeof src === 'string' ? withBasePath(src) : src

      return <img {...props} alt={alt || ''} src={resolvedSrc} />
    },
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
