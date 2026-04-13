export type NavItem = {
  name: string;
  href: string;
};

export type NavSection = {
  title: string | null;
  items: NavItem[];
};

export const navigation: NavSection[] = [
  {
    title: null,
    items: [
      { name: "Introduction", href: "/" },
      { name: "Installation", href: "/installation" },
      { name: "Quick Start", href: "/quick-start" },
      { name: "AI Agents", href: "/ai-agents" },
    ],
  },
  {
    title: "Core Features",
    items: [
      { name: "Commands", href: "/commands" },
      { name: "Search", href: "/search" },
      { name: "Plugins", href: "/plugins" },
      { name: "Permissions", href: "/permissions" },
    ],
  },
  {
    title: "Integrations",
    items: [
      { name: "OpenAPI & Postman", href: "/openapi" },
      { name: "MCP Server", href: "/mcp" },
      { name: "Claude Code", href: "/claude-code" },
    ],
  },
  {
    title: "Extend",
    items: [{ name: "Creating Plugins", href: "/creating-plugins" }],
  },
  {
    title: null,
    items: [{ name: "Changelog", href: "/changelog" }],
  },
];

export const allDocsPages: NavItem[] = navigation.flatMap(
  (section) => section.items,
);
