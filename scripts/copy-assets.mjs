// Copies the static frontend (src/public) into dist/public after `tsc` runs.
//
// Why this exists: `tsc` only emits the compiled .ts -> .js files into dist/.
// It does NOT copy non-TypeScript assets such as our single-page index.html.
// Since config.ts resolves the public directory relative to its own compiled
// location (dist/ in production), the HTML must live next to the compiled code.
// This tiny, dependency-free Node script does that copy in a cross-platform way.

import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.dirname(fileURLToPath(import.meta.url)).replace(/[\\/]scripts$/, "");
const from = path.join(projectRoot, "src", "public");
const to = path.join(projectRoot, "dist", "public");

await mkdir(to, { recursive: true });
await cp(from, to, { recursive: true });

console.log(`[copy-assets] copied ${from} -> ${to}`);
