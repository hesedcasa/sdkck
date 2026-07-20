"use client";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useLanguage } from "@/lib/LanguageProvider";
import styles from "./page.module.css";

export default function Home() {
  const { content } = useLanguage();

  return (
    <main className={styles.main}>
      <article className={styles.doc}>
        <header className={styles.header}>
          <LanguageSwitcher />
          <h1 className={styles.title}>{content.title}</h1>
          <p className={styles.subtitle}>{content.subtitle}</p>
          <p className={styles.updated}>{content.updated}</p>
        </header>

        <p className={styles.intro}>{content.intro}</p>

        {content.sections.map((section) => (
          <section key={section.heading} className={styles.section}>
            <h2 className={styles.heading}>{section.heading}</h2>
            {section.paragraphs.map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </section>
        ))}
      </article>
    </main>
  );
}
