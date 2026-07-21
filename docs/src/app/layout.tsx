import type {Metadata} from 'next'

import './globals.css'

export const metadata: Metadata = {
  description:
    'One CLI to search, connect, and command every tool in your stack. Zero context window bloat. Maximum productivity.',
  title: {
    default: 'Sidekick | The Best Companion Tool for AI Agents',
    template: '%s | Sidekick',
  },
}

// The <html>/<body> tags live in app/[locale]/layout.tsx so the lang attribute
// can be set per locale. This root layout only passes children through.
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return children
}
