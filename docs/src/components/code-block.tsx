import { codeToHtml } from "shiki";
import { CopyButton } from "./copy-button";

const darkTheme = {
  name: "sidekick-dark",
  type: "dark" as const,
  colors: {
    "editor.background": "transparent",
    "editor.foreground": "#EDEDED",
  },
  settings: [
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "#A1A1A1" },
    },
    {
      scope: ["string", "string.quoted", "string.template"],
      settings: { foreground: "#00CA50" },
    },
    {
      scope: [
        "constant.numeric",
        "constant.language.boolean",
        "constant.language.null",
      ],
      settings: { foreground: "#47A8FF" },
    },
    {
      scope: ["keyword", "storage.type", "storage.modifier"],
      settings: { foreground: "#FF4D8D" },
    },
    {
      scope: ["keyword.operator", "keyword.control"],
      settings: { foreground: "#FF4D8D" },
    },
    {
      scope: ["entity.name.function", "support.function", "meta.function-call"],
      settings: { foreground: "#C472FB" },
    },
    {
      scope: ["variable", "variable.other"],
      settings: { foreground: "#EDEDED" },
    },
    {
      scope: ["variable.parameter"],
      settings: { foreground: "#FF9300" },
    },
    {
      scope: ["entity.name.tag", "entity.name.type"],
      settings: { foreground: "#FF4D8D" },
    },
    {
      scope: ["punctuation"],
      settings: { foreground: "#EDEDED" },
    },
    {
      scope: [
        "support.type.property-name",
        "meta.object-literal.key",
      ],
      settings: { foreground: "#FF4D8D" },
    },
    {
      scope: ["entity.other.attribute-name"],
      settings: { foreground: "#00CA50" },
    },
  ],
};

const lightTheme = {
  name: "sidekick-light",
  type: "light" as const,
  colors: {
    "editor.background": "transparent",
    "editor.foreground": "#171717",
  },
  settings: [
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "#6B7280" },
    },
    {
      scope: ["string", "string.quoted", "string.template"],
      settings: { foreground: "#067A6E" },
    },
    {
      scope: [
        "constant.numeric",
        "constant.language.boolean",
        "constant.language.null",
      ],
      settings: { foreground: "#0070C0" },
    },
    {
      scope: ["keyword", "storage.type", "storage.modifier"],
      settings: { foreground: "#D6409F" },
    },
    {
      scope: ["keyword.operator", "keyword.control"],
      settings: { foreground: "#D6409F" },
    },
    {
      scope: ["entity.name.function", "support.function", "meta.function-call"],
      settings: { foreground: "#6E56CF" },
    },
    {
      scope: ["variable", "variable.other"],
      settings: { foreground: "#171717" },
    },
    {
      scope: ["variable.parameter"],
      settings: { foreground: "#B45309" },
    },
    {
      scope: ["entity.name.tag", "entity.name.type"],
      settings: { foreground: "#D6409F" },
    },
    {
      scope: ["punctuation"],
      settings: { foreground: "#6B7280" },
    },
    {
      scope: [
        "support.type.property-name",
        "meta.object-literal.key",
      ],
      settings: { foreground: "#D6409F" },
    },
    {
      scope: ["entity.other.attribute-name"],
      settings: { foreground: "#067A6E" },
    },
  ],
};

interface CodeBlockProps {
  code: string;
  lang?: string;
}

export async function CodeBlock({ code, lang = "bash" }: CodeBlockProps) {
  const trimmedCode = code.trim();
  const html = await codeToHtml(trimmedCode, {
    lang,
    themes: {
      light: lightTheme,
      dark: darkTheme,
    },
    defaultColor: false,
  });

  return (
    <div className="code-block relative group">
      <CopyButton code={trimmedCode} />
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
