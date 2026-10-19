import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EXT = [".js", ".jsx", ".mjs"];

export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && context.parentURL && !/\.[a-z]+$/i.test(specifier)) {
    for (const ext of EXT) {
      const url = new URL(specifier + ext, context.parentURL);
      if (existsSync(fileURLToPath(url))) return next(url.href, context);
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  const out = await next(url, context);
  if (url.includes("/src/") && out.source) {
    const text = String(out.source).replace(/import\.meta\.env/g, '({ BASE_URL: "/app/" })');
    return { ...out, source: text };
  }
  return out;
}
