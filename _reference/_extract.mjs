// Extracts <script type="module"> blocks from three.js example HTML files
// and writes them as .js reference files.
import { readFileSync, writeFileSync } from 'node:fs';

const files = process.argv.slice(2);
for (const file of files) {
  const html = readFileSync(file, 'utf8');
  const matches = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
  if (matches.length === 0) {
    console.log(`${file}: NO module script found`);
    continue;
  }
  const js = matches.map((m) => m[1]).join('\n// ---\n\n');
  const out = file.replace(/\.html$/, '.js');
  writeFileSync(out, js);
  console.log(`${file} -> ${out} (${js.length} chars, ${matches.length} block(s))`);
}
