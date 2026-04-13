import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Header } from "@/components/header";
import { DocsSidebar } from "@/components/docs-sidebar";
import { DocsMobileNav } from "@/components/docs-mobile-nav";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Sidekick | The Best Companion Tool for AI Agents",
    template: "%s | Sidekick",
  },
  description:
    "One CLI to search, connect, and command every tool in your stack. Zero context window bloat. Maximum productivity.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${geistMono.variable} bg-white text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100`}
      >
        <ThemeProvider>
          <Header />
          <DocsMobileNav />
          <div className="max-w-5xl mx-auto px-6 py-8 lg:py-12 flex gap-16">
            <aside className="w-52 shrink-0 hidden lg:block sticky top-20 h-[calc(100vh-5rem)] overflow-y-auto">
              <DocsSidebar />
            </aside>
            <div className="flex-1 min-w-0 max-w-3xl pb-20">
              <article className="prose">{children}</article>
            </div>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
