/**
 * P13 · Deployment build.
 * Produces standalone paste-and-go documents in dist/: every local image
 * referenced by the pages is inlined as a data URI, so there is no assets
 * folder to upload alongside them.
 *
 *   node build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const PAGES = ['index.html', 'thank-you.html', 'palette-options.html'];
const MIME = { '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.webp':'image/webp', '.svg':'image/svg+xml', '.gif':'image/gif' };

mkdirSync(join(root, 'dist'), { recursive: true });

let totalRaw = 0, totalInlined = 0;
const missing = new Set();
const stillRelative = new Set();

for (const page of PAGES) {
  let html = readFileSync(join(root, page), 'utf8');

  // inline <img src="assets/..."> and CSS url(assets/...)
  html = html.replace(/(src|url\()\s*=?\s*["'(]?(assets\/[^"')\s]+)["')]?/g, (m, attr, rel) => {
    const file = join(root, rel);
    if (!existsSync(file)) { missing.add(rel); return m; }
    const ext = extname(file).toLowerCase();
    const mime = MIME[ext];
    if (!mime) { stillRelative.add(rel); return m; }
    const buf = readFileSync(file);
    totalRaw += statSync(file).size;
    const uri = `data:${mime};base64,${buf.toString('base64')}`;
    totalInlined += uri.length;
    return attr === 'src' ? `src="${uri}"` : `url(${uri})`;
  });

  // catalogue what still needs setting before publish: highlighted .todo
  // spans, empty media slots, and the marked integration blocks
  const placeholders = [
    ...[...html.matchAll(/class="todo"[^>]*>\[([^\]]{3,90})\]/g)].map((m) => m[1]),
    ...[...html.matchAll(/data-file="([^"]+)"/g)].map((m) => 'image: ' + m[1].split(' ')[0]),
    ...(html.includes('[LEADCONNECTOR WEBHOOK URL]') ? ['CRM integration: LeadConnector webhook URL in submitLead()'] : []),
    ...(html.includes('[PASTE CONVERSION TAG HERE]') ? ['conversion tag block in <head>'] : []),
  ];
  const relLinks = [...html.matchAll(/href="([^"#][^":]*?)"/g)]
    .map((m) => m[1])
    .filter((h) => !h.startsWith('http') && !h.startsWith('tel:') && !h.startsWith('mailto:'));

  writeFileSync(join(root, 'dist', page), html);
  console.log(`\n${page} → dist/${page}`);
  if (placeholders.length) {
    console.log(`  Unresolved [placeholders] (${placeholders.length}) — page keeps noindex until these are set:`);
    [...new Set(placeholders)].forEach((p) => console.log(`   · [${p}]`));
  }
  if (relLinks.length) {
    console.log('  Relative URLs that only resolve while the files sit in one folder:');
    [...new Set(relLinks)].forEach((l) => console.log(`   · ${l}`));
  }
}

if (missing.size) {
  console.log('\nImage references with no file yet (labelled slots will show instead):');
  [...missing].forEach((f) => console.log(` · ${f}`));
}

console.log(`\nTrade-off, stated plainly: a data URI cannot be cached separately from the
document, and base64 costs ~33% more bytes than the file (${totalRaw ? Math.round(totalRaw/1024) + 'KB raw → ~' + Math.round(totalInlined/1024) + 'KB inlined' : 'no images inlined yet'}).
Every visitor re-downloads the whole payload. Inlining is the get-it-live-today
option; hosting the images and keeping URL src attributes is the fast one.`);
