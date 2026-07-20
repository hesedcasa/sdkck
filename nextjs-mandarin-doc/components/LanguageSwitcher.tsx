"use client";

import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/dictionaries";
import { useLanguage } from "@/lib/LanguageProvider";
import styles from "./LanguageSwitcher.module.css";

export function LanguageSwitcher() {
  const { locale, setLocale, content } = useLanguage();

  return (
    <div className={styles.switcher} role="group" aria-label={content.switcherLabel}>
      <span className={styles.label}>{content.switcherLabel}:</span>
      <div className={styles.buttons}>
        {LOCALES.map((code: Locale) => (
          <button
            key={code}
            type="button"
            className={styles.button}
            aria-pressed={code === locale}
            onClick={() => setLocale(code)}
          >
            {LOCALE_LABELS[code]}
          </button>
        ))}
      </div>
    </div>
  );
}
