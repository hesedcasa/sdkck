import type {Metadata} from 'next'

import './globals.css'

export const metadata: Metadata = {
  description: 'Browse and run sdkck commands from your browser',
  title: 'sdkck web UI',
}

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
