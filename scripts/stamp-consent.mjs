/**
 * Stamps partials/consent.html (cookie banner, styles and script) into every
 * funnel page, between <!-- consent:start --> and <!-- consent:end --> just
 * before </body>. Pages stay single self-contained files.
 *
 *   node scripts/stamp-consent.mjs          (write changes)
 *   node scripts/stamp-consent.mjs --check  (exit 1 if any page is out of date)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
export const FUNNEL_PAGES = ['index.html', 'smile-makeover.html', 'thank-you.html', 'smile-thank-you.html'];
const block = `<!-- consent:start -->\n${readFileSync(join(root, 'partials/consent.html'), 'utf8').trimEnd()}\n<!-- consent:end -->`;

for (const page of FUNNEL_PAGES) {
  const file = join(root, page);
  const before = readFileSync(file, 'utf8');
  const after = before.includes('<!-- consent:start -->')
    ? before.replace(/<!-- consent:start -->[\s\S]*?<!-- consent:end -->/, () => block)
    : before.replace(/<\/body>/, () => `${block}\n</body>`);
  if (after === before) continue;
  if (check) { console.error(`out of date: ${page} — run node scripts/stamp-consent.mjs`); process.exitCode = 1; }
  else { writeFileSync(file, after); console.log(`updated ${page}`); }
}
