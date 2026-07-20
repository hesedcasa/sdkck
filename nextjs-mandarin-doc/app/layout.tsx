import type { Metadata } from "next";
import { LanguageProvider } from "@/lib/LanguageProvider";
import { HTML_LANG, DEFAULT_LOCALE } from "@/lib/dictionaries";
import "./globals.css";

export const metadata: Metadata = {
  title: "中国茶文化简介 / Chinese Tea Culture",
  description:
    "A Next.js document rendered in Mandarin with an in-page language switcher.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Rendered with the default (Mandarin) language on the server; the
  // LanguageProvider updates <html lang> on the client when the user switches.
  return (
    <html lang={HTML_LANG[DEFAULT_LOCALE]}>
      <body>
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
