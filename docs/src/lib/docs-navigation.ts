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

export const allDocsPages: NavItem[] = navigation.flatMap((section) => section.items)
