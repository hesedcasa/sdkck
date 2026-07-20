// Document content in three languages. Mandarin (Simplified Chinese) is the
// default; users can switch the whole document to Traditional Chinese or English
// with the in-page language switcher.

export type Locale = "zh" | "zh-Hant" | "en";

export const LOCALES: Locale[] = ["zh", "zh-Hant", "en"];

export const DEFAULT_LOCALE: Locale = "zh";

// Human-readable label for each locale, shown in the language switcher.
export const LOCALE_LABELS: Record<Locale, string> = {
  zh: "简体中文",
  "zh-Hant": "繁體中文",
  en: "English",
};

// The BCP-47 tag applied to <html lang>, so screen readers and browsers know
// which language is being displayed.
export const HTML_LANG: Record<Locale, string> = {
  zh: "zh-Hans",
  "zh-Hant": "zh-Hant",
  en: "en",
};

export interface Section {
  heading: string;
  paragraphs: string[];
}

export interface DocumentContent {
  title: string;
  subtitle: string;
  updated: string;
  intro: string;
  sections: Section[];
  switcherLabel: string;
}

export const dictionaries: Record<Locale, DocumentContent> = {
  zh: {
    title: "中国茶文化简介",
    subtitle: "从一片叶子看见千年的传承",
    updated: "最后更新：2026 年 7 月",
    switcherLabel: "语言",
    intro:
      "茶起源于中国，至今已有数千年的历史。它不仅是一种饮品，更承载着礼仪、哲学与生活方式。本文将带您了解中国茶的起源、主要种类以及品茶的礼仪。",
    sections: [
      {
        heading: "茶的起源",
        paragraphs: [
          "相传神农尝百草时发现了茶的解毒功效，从此茶叶逐渐走入人们的日常生活。",
          "到了唐代，陆羽所著的《茶经》系统地记录了茶的种植、采制与饮用方法，被誉为世界上第一部茶叶专著。",
        ],
      },
      {
        heading: "主要种类",
        paragraphs: [
          "中国茶通常按发酵程度分为六大类：绿茶、白茶、黄茶、青茶（乌龙茶）、红茶与黑茶。",
          "不同的种类拥有各自独特的香气与口感，例如清爽的龙井绿茶、醇厚的普洱黑茶，各具风味。",
        ],
      },
      {
        heading: "品茶礼仪",
        paragraphs: [
          "品茶讲究观其色、闻其香、品其味，注重心境的平和与专注。",
          "以茶待客是中国传统的待客之道，为客人斟茶时通常只倒七分满，寓意“七分茶，三分情”。",
        ],
      },
    ],
  },
  "zh-Hant": {
    title: "中國茶文化簡介",
    subtitle: "從一片葉子看見千年的傳承",
    updated: "最後更新：2026 年 7 月",
    switcherLabel: "語言",
    intro:
      "茶起源於中國，至今已有數千年的歷史。它不僅是一種飲品，更承載著禮儀、哲學與生活方式。本文將帶您了解中國茶的起源、主要種類以及品茶的禮儀。",
    sections: [
      {
        heading: "茶的起源",
        paragraphs: [
          "相傳神農嘗百草時發現了茶的解毒功效，從此茶葉逐漸走入人們的日常生活。",
          "到了唐代，陸羽所著的《茶經》系統地記錄了茶的種植、採製與飲用方法，被譽為世界上第一部茶葉專著。",
        ],
      },
      {
        heading: "主要種類",
        paragraphs: [
          "中國茶通常按發酵程度分為六大類：綠茶、白茶、黃茶、青茶（烏龍茶）、紅茶與黑茶。",
          "不同的種類擁有各自獨特的香氣與口感，例如清爽的龍井綠茶、醇厚的普洱黑茶，各具風味。",
        ],
      },
      {
        heading: "品茶禮儀",
        paragraphs: [
          "品茶講究觀其色、聞其香、品其味，注重心境的平和與專注。",
          "以茶待客是中國傳統的待客之道，為客人斟茶時通常只倒七分滿，寓意「七分茶，三分情」。",
        ],
      },
    ],
  },
  en: {
    title: "An Introduction to Chinese Tea Culture",
    subtitle: "A thousand years of heritage seen through a single leaf",
    updated: "Last updated: July 2026",
    switcherLabel: "Language",
    intro:
      "Tea originated in China and has a history spanning several thousand years. It is more than a beverage — it carries etiquette, philosophy, and a way of life. This article introduces the origins of Chinese tea, its main varieties, and the etiquette of tasting it.",
    sections: [
      {
        heading: "Origins of Tea",
        paragraphs: [
          "Legend holds that Shennong discovered tea's detoxifying properties while tasting hundreds of herbs, and from then on tea gradually entered everyday life.",
          "By the Tang dynasty, Lu Yu's 'The Classic of Tea' systematically recorded how tea was grown, processed, and brewed, and is regarded as the world's first monograph devoted to tea.",
        ],
      },
      {
        heading: "Main Varieties",
        paragraphs: [
          "Chinese tea is usually divided into six categories by degree of oxidation: green, white, yellow, oolong, black (red), and dark (fermented) tea.",
          "Each variety has its own distinct aroma and taste — from the fresh Longjing green tea to the mellow Pu'er dark tea, every one has its own character.",
        ],
      },
      {
        heading: "The Etiquette of Tasting",
        paragraphs: [
          "Tasting tea means appreciating its color, inhaling its fragrance, and savoring its flavor, all with a calm and focused mind.",
          "Serving tea to guests is a traditional Chinese gesture of hospitality. A cup is customarily filled only seven-tenths full, symbolizing 'seven parts tea, three parts affection.'",
        ],
      },
    ],
  },
};
