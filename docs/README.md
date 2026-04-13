# Sidekick Docs

The user guide website for Sidekick (sdkck), built with Next.js, MDX, Tailwind CSS, and Shiki.

## Development

```bash
cd docs
npm install
npm run dev
```

The docs site runs at http://localhost:3000.

## Structure

```
docs/
├── src/
│   ├── app/                 # Next.js App Router pages (MDX)
│   ├── components/          # UI components (header, sidebar, theme toggle)
│   └── lib/                 # Navigation config and utilities
├── mdx-components.tsx       # MDX component overrides (headings, code blocks)
├── next.config.mjs          # Next.js + MDX configuration
├── postcss.config.mjs       # Tailwind v4 PostCSS plugin
└── tsconfig.json            # TypeScript configuration
```

## Adding a page

1. Create `src/app/my-page/page.mdx`
2. Add an entry to `src/lib/docs-navigation.ts`

That's it — the sidebar and mobile nav pick it up automatically.

## Build

```bash
npm run build
npm run start
```
