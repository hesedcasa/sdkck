// hrefs are locale-agnostic — next-intl's <Link> adds the active locale prefix
// (and Next.js adds basePath). `key` maps into the `nav.items` / `nav.sections`
// message namespaces so labels are translated per locale.
export type NavItem = {
  href: string
  key: string
}

export type NavSection = {
  items: NavItem[]
  titleKey: null | string
}

export const navigation: NavSection[] = [
  {
    items: [
      {href: '/', key: 'introduction'},
      {href: '/installation', key: 'installation'},
      {href: '/quick-start', key: 'quickStart'},
      {href: '/ai-agents', key: 'aiAgents'},
    ],
    titleKey: null,
  },
  {
    items: [
      {href: '/skills/sidekick', key: 'skillsSidekick'},
      {href: '/skills/extract-api', key: 'skillsExtractApi'},
    ],
    titleKey: 'skills',
  },
  {
    items: [
      {href: '/commands', key: 'commands'},
      {href: '/search', key: 'search'},
      {href: '/plugins', key: 'plugins'},
      {href: '/permissions', key: 'permissions'},
    ],
    titleKey: 'coreFeatures',
  },
  {
    items: [
      {href: '/api', key: 'api'},
      {href: '/mcp', key: 'mcp'},
      {href: '/mcp-client', key: 'mcpClient'},
    ],
    titleKey: 'integrations',
  },
  {
    items: [
      {href: '/official-plugins/jira', key: 'jira'},
      {href: '/official-plugins/bitbucket', key: 'bitbucket'},
      {href: '/official-plugins/sentry', key: 'sentry'},
      {href: '/official-plugins/mysql', key: 'mysql'},
      {href: '/official-plugins/postgresql', key: 'postgresql'},
      {href: '/official-plugins/supabase', key: 'supabase'},
      {href: '/official-plugins/confluence', key: 'confluence'},
      {href: '/official-plugins/webui', key: 'webui'},
    ],
    titleKey: 'officialPlugins',
  },
  {
    items: [{href: '/creating-plugins', key: 'creatingPlugins'}],
    titleKey: 'extend',
  },
  {
    items: [{href: '/changelog', key: 'changelog'}],
    titleKey: null,
  },
]

export const allDocsPages: NavItem[] = navigation.flatMap((section) => section.items)
