// Builds src/ into /assets/fx and points every page at the new boot file.
//   cd tools/fx && npm install && npm run build
// then, from the repo root, refresh the CSP and run the search check (see README).
import { build } from 'esbuild';
import { readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const out = path.join(root, 'assets/fx');
const pages = ['index.html', '404.html'];

await rm(out, { recursive: true, force: true });
const result = await build({
  entryPoints: [path.join(here, 'src/boot.js')],
  outdir: out,
  bundle: true,
  splitting: true,
  format: 'esm',
  target: 'es2020',
  minify: true,
  entryNames: '[name].[hash]',
  chunkNames: '[name].[hash]',
  legalComments: 'eof', // keeps the three.js MIT notice
  metafile: true,
  logLevel: 'warning',
});

const boot = Object.keys(result.metafile.outputs).map((f) => path.basename(f)).find((f) => f.startsWith('boot.'));
for (const page of pages) {
  const file = path.join(root, page);
  const html = await readFile(file, 'utf8');
  const next = html.replace(/\/assets\/fx\/boot\.[A-Za-z0-9]+\.js/g, `/assets/fx/${boot}`);
  if (!next.includes(`/assets/fx/${boot}`)) throw new Error(`${page} has no /assets/fx/boot.*.js script tag`);
  if (next !== html) await writeFile(file, next);
}

for (const f of (await readdir(out)).sort()) {
  const buf = await readFile(path.join(out, f));
  console.log(`${f.padEnd(28)} ${(buf.length / 1024).toFixed(1).padStart(7)} KB  ${(gzipSync(buf).length / 1024).toFixed(1).padStart(6)} KB gz`);
}
console.log(`pages now load /assets/fx/${boot}`);
