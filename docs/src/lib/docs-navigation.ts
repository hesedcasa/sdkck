export type NavItem = {
  href: string
  name: string
}

export type NavSection = {
  items: NavItem[]
  title: null | string
}

export const navigation: NavSection[] = [
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
      {href: '/commands', name: 'Commands'},
      {href: '/search', name: 'Search'},
      {href: '/plugins', name: 'Plugins'},
      {href: '/permissions', name: 'Permissions'},
    ],
    title: 'Core Features',
  },
  {
    items: [
      {href: '/openapi', name: 'API to Commands'},
      {href: '/mcp', name: 'MCP Server'},
    ],
    title: 'Integrations',
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

export const allDocsPages: NavItem[] = navigation.flatMap((section) => section.items)
