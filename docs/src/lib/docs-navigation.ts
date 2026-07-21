export type Locale = 'en' | 'zh'

export const LOCALES: Locale[] = ['en', 'zh']

export const DEFAULT_LOCALE: Locale = 'en'

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  zh: '中文',
}

export type NavItem = {
  href: string
  name: string
}

export type NavSection = {
  items: NavItem[]
  title: null | string
}

// Base (English) navigation. hrefs are locale-agnostic and get prefixed with
// `/zh` for the Mandarin site by getNavigation().
const baseNavigation: NavSection[] = [
  {
    items: [
      {href: '/', name: 'Introduction'},
      {href: '/installation', name: 'Installation'},
      {href: '/quick-start', name: 'Quick Start'},
      {href: '/ai-agents', name: 'AI Agents'},
    ],
    title: null,
  },
  {
    items: [
      {href: '/skills/sidekick', name: 'sidekick'},
      {href: '/skills/extract-api', name: 'extract-api'},
    ],
    title: 'Skills',
  },
  {
    items: [
      {href: '/commands', name: 'Commands'},
      {href: '/search', name: 'Search'},
      {href: '/plugins', name: 'Plugins'},
      {href: '/permissions', name: 'Permissions'},
    ],
    title: 'Core Features',
  },
  {
    items: [
      {href: '/api', name: 'API to Commands'},
      {href: '/mcp', name: 'MCP Server'},
      {href: '/mcp-client', name: 'MCP Client'},
    ],
    title: 'Integrations',
  },
  {
    items: [
      {href: '/official-plugins/jira', name: 'Jira'},
      {href: '/official-plugins/bitbucket', name: 'Bitbucket'},
      {href: '/official-plugins/sentry', name: 'Sentry'},
      {href: '/official-plugins/mysql', name: 'MySQL'},
      {href: '/official-plugins/postgresql', name: 'PostgreSQL'},
      {href: '/official-plugins/supabase', name: 'Supabase'},
      {href: '/official-plugins/confluence', name: 'Confluence'},
      {href: '/official-plugins/webui', name: 'WebUI'},
    ],
    title: 'Official Plugins',
  },
  {
    items: [{href: '/creating-plugins', name: 'Creating Plugins'}],
    title: 'Extend',
  },
  {
    items: [{href: '/changelog', name: 'Changelog'}],
    title: null,
  },
]

// Translations for section titles and item names displayed in the sidebar/nav.
// Keys are the English strings from baseNavigation.
const zhSectionTitles: Record<string, string> = {
  'Core Features': '核心功能',
  Extend: '扩展',
  Integrations: '集成',
  'Official Plugins': '官方插件',
  Skills: '技能',
}

const zhItemNames: Record<string, string> = {
  'AI Agents': 'AI 智能体',
  'API to Commands': 'API 转命令',
  Changelog: '更新日志',
  Commands: '命令',
  'Creating Plugins': '创建插件',
  Installation: '安装',
  Introduction: '简介',
  'MCP Client': 'MCP 客户端',
  'MCP Server': 'MCP 服务器',
  Permissions: '权限',
  Plugins: '插件',
  'Quick Start': '快速开始',
  Search: '搜索',
}

export function localeFromPathname(pathname: string): Locale {
  return pathname === '/zh' || pathname.startsWith('/zh/') ? 'zh' : 'en'
}

// Returns the equivalent path in the other locale. Used by the language toggle.
export function pathForLocale(pathname: string, locale: Locale): string {
  const current = localeFromPathname(pathname)
  if (current === locale) return pathname

  if (locale === 'zh') {
    return pathname === '/' ? '/zh' : `/zh${pathname}`
  }

  // Switching to English: strip the /zh prefix.
  const stripped = pathname.replace(/^\/zh/, '')
  return stripped === '' ? '/' : stripped
}

// Returns navigation with hrefs and labels localized for the given locale.
export function getNavigation(locale: Locale): NavSection[] {
  if (locale === 'en') return baseNavigation

  return baseNavigation.map((section) => ({
    items: section.items.map((item) => ({
      href: item.href === '/' ? '/zh' : `/zh${item.href}`,
      name: zhItemNames[item.name] ?? item.name,
    })),
    title: section.title ? (zhSectionTitles[section.title] ?? section.title) : section.title,
  }))
}

export const allDocsPages: NavItem[] = LOCALES.flatMap((locale) =>
  getNavigation(locale).flatMap((section) => section.items),
)
