# Mandarin Document with Language Switch

A small, self-contained [Next.js](https://nextjs.org) (App Router) app that renders
a document in **Mandarin (Simplified Chinese)** by default and lets the reader switch
the document's language on the fly.

## Features

- **Mandarin by default** — the document loads in Simplified Chinese (`zh`).
- **In-page language switcher** — toggle between Simplified Chinese, Traditional
  Chinese (`zh-Hant`), and English (`en`) without a page reload.
- **Choice is remembered** — the selected language is saved in `localStorage` and
  restored on the next visit.
- **Accessible** — the switcher uses `aria-pressed`, and `<html lang>` updates to
  match the active language for screen readers and browsers.

## Getting started

```bash
cd nextjs-mandarin-doc
npm install
npm run dev
```

Then open http://localhost:3000.

## Project layout

| Path                                    | Purpose                                             |
| --------------------------------------- | --------------------------------------------------- |
| `lib/dictionaries.ts`                   | Document content and labels for every language.     |
| `lib/LanguageProvider.tsx`              | Client context holding the active language.         |
| `components/LanguageSwitcher.tsx`       | The language-switch button group.                   |
| `app/page.tsx`                          | Renders the document from the active dictionary.    |
| `app/layout.tsx`                        | Sets the initial `<html lang>` and wraps the app.   |

## Adding another language

1. Add the locale code to `Locale`, `LOCALES`, `LOCALE_LABELS`, and `HTML_LANG` in
   `lib/dictionaries.ts`.
2. Add a matching entry to the `dictionaries` object with the translated content.

The switcher and document pick it up automatically.
