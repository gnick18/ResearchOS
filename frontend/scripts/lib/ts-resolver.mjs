/**
 * Tiny Node module-resolver hook for `--experimental-strip-types` test
 * scripts. Node's strip-types mode runs `.ts` files directly but does NOT
 * extend ESM resolution to find `./foo` → `./foo.ts` the way bundlers and
 * the TS compiler do. This hook fills that gap so source modules can use
 * their normal extensionless relative imports.
 *
 * Register with:
 *   import { register } from "node:module";
 *   register("./lib/ts-resolver.mjs", import.meta.url);
 *
 * Only handles relative specifiers (`./` and `../`). Bare specifiers,
 * absolute URLs, and `node:` builtins fall through unchanged.
 */
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

export async function resolve(specifier, context, nextResolve) {
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL &&
    path.extname(specifier) === ""
  ) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    const base = path.resolve(parentDir, specifier);
    const candidates = [
      `${base}.ts`,
      `${base}.tsx`,
      path.join(base, "index.ts"),
      path.join(base, "index.tsx"),
    ];
    for (const c of candidates) {
      if (existsSync(c) && statSync(c).isFile()) {
        return nextResolve(pathToFileURL(c).href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
