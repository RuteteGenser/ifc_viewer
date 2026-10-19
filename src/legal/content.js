// Loads one legal document for the app (each Markdown file is its own small lazy chunk).
import { fillTemplate } from "./seller";

const files = import.meta.glob("./docs/*.md", { query: "?raw", import: "default" });

export async function loadDoc(doc, lang) {
  const load = files[`./docs/${doc}.${lang}.md`];
  return load ? fillTemplate(await load()) : null;
}
