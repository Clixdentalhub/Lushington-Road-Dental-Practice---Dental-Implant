/**
 * P11 · Verification harness.
 * Runs every page at 360/375/414/768/1024/1280/1440 and asserts layout,
 * accessibility, contrast (computed from relative luminance), form
 * behaviour, and typography — then screenshots as well as measures.
 *
 *   node verify.mjs
 */
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';

const root = dirname(fileURLToPath(import.meta.url));
const WIDTHS = [360, 375, 414, 768, 1024, 1280, 1440];
const PAGES = ['index.html', 'smile-makeover.html', 'thank-you.html', 'smile-thank-you.html', 'labs/tokens.html'];
const shotDir = join(root, 'verify-screenshots');
mkdirSync(shotDir, { recursive: true });

let failures = 0;
const fail = (msg) => { failures++; console.error(`  FAIL  ${msg}`); };
const pass = (msg) => console.log(`  ok    ${msg}`);

// Use CHROMIUM_PATH if set, else the newest preinstalled Chromium (the version folder changes between images)
const findChromium = () => {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = '/opt/pw-browsers';
  const dirs = existsSync(base) ? readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => b.split('-')[1] - a.split('-')[1]) : [];
  for (const d of dirs) for (const sub of ['chrome-linux64', 'chrome-linux']) {
    const p = join(base, d, sub, 'chrome');
    if (existsSync(p)) return p;
  }
  return undefined;  // fall back to playwright's own lookup
};
const browser = await chromium.launch({ executablePath: findChromium() });

const stubNetwork = (pg) =>
  pg.route(/^https?:\/\//, (r) => {
    const type = r.request().resourceType();
    if (type === 'stylesheet') return r.fulfill({ body: '', contentType: 'text/css' });
    if (type === 'document') return r.fulfill({ body: '<html></html>', contentType: 'text/html' });
    return r.fulfill({ body: '', contentType: 'text/plain' });
  });

for (const page of PAGES) {
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: 'no-preference',
    });
    const pg = await ctx.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    pg.on('console', (m) => {
      // Only our own document's errors count; the map iframe can't load offline.
      if (m.type() === 'error' && m.location().url.startsWith('file://')) {
        consoleErrors.push(m.text());
      }
    });
    pg.on('pageerror', (e) => pageErrors.push(String(e)));
    // Stub all network (maps iframe, Google Fonts) so offline runs are
    // deterministic and never hang on the egress proxy.
    await stubNetwork(pg);

    await pg.goto(pathToFileURL(join(root, page)).href, { waitUntil: 'load' });
    await pg.waitForTimeout(400);
    console.log(`\n== ${page} @ ${width}px ==`);

    // 1 · no horizontal scroll
    const overflow = await pg.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    overflow === 0 ? pass('no horizontal overflow') : fail(`horizontal overflow of ${overflow}px`);

    // 2 · console / page errors
    consoleErrors.length === 0 ? pass('no console errors') : fail(`console errors: ${consoleErrors.join(' | ')}`);
    pageErrors.length === 0 ? pass('no page errors') : fail(`page errors: ${pageErrors.join(' | ')}`);

    // 3 · every image loads and carries alt
    const badImgs = await pg.evaluate(() =>
      [...document.images]
        .filter((i) => !i.complete || i.naturalWidth === 0 || !i.hasAttribute('alt'))
        .map((i) => i.getAttribute('src'))
    );
    badImgs.length === 0 ? pass('all images load with alt') : fail(`bad images: ${badImgs.join(', ')}`);

    // 4 · exactly one h1; no dead/bracketed/#-only hrefs
    const h1s = await pg.evaluate(() => document.querySelectorAll('h1').length);
    h1s === 1 ? pass('exactly one h1') : fail(`${h1s} h1 elements`);
    const badHrefs = await pg.evaluate(() =>
      [...document.querySelectorAll('a[href]')]
        .map((a) => a.getAttribute('href'))
        .filter((h) => h === '#' || h === '' || /\[.*\]/.test(h))
    );
    badHrefs.length === 0 ? pass('no dead or bracketed hrefs') : fail(`bad hrefs: ${badHrefs.join(', ')}`);

    // 5 · JSON-LD parses
    const ldOk = await pg.evaluate(() => {
      const blocks = [...document.querySelectorAll('script[type="application/ld+json"]')];
      try { blocks.forEach((b) => JSON.parse(b.textContent)); return true; }
      catch { return false; }
    });
    ldOk ? pass('JSON-LD parses') : fail('JSON-LD failed to parse');

    // 6 · contrast on dark bands, computed from relative luminance
    const contrastFails = await pg.evaluate(() => {
      const lum = (rgb) => {
        const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map((n) => +n / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ratio = (a, b) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      const out = [];
      document.querySelectorAll('.band--dark, .site-footer').forEach((band) => {
        const bandBg = getComputedStyle(band).backgroundColor;
        band.querySelectorAll('h1,h2,h3,p,span,li,a,dd,strong,cite,blockquote').forEach((el) => {
          if (!el.textContent.trim()) return;
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') return;
          // skip elements with their own opaque backgrounds (buttons, chips, todos)
          let bg = bandBg; let node = el; let opaque = false;
          while (node && node !== band) {
            const nb = getComputedStyle(node).backgroundColor;
            if (nb && !nb.includes('rgba(0, 0, 0, 0)') && !/rgba\(.*0\)$/.test(nb)) { bg = nb; opaque = true; break; }
            node = node.parentElement;
          }
          if (opaque) return; // opaque sub-surfaces (CTAs, .todo) proven in the token lab
          const r = ratio(cs.color, bg);
          if (r < 4.5) out.push(`${el.tagName}.${el.className} "${el.textContent.trim().slice(0, 30)}" ${r.toFixed(2)}:1`);
        });
      });
      return out;
    });
    contrastFails.length === 0
      ? pass('dark-band text contrast ≥4.5:1')
      : fail(`contrast: ${contrastFails.slice(0, 4).join(' | ')}`);

    // 7 · --header-h ≥ real rendered header
    if (page !== 'labs/tokens.html') {
      const hdr = await pg.evaluate(() => {
        const el = document.querySelector('.site-header');
        const token = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 0;
        return { real: el ? el.getBoundingClientRect().height : 0, token };
      });
      if (page === 'index.html' || page === 'smile-makeover.html') {
        hdr.token >= hdr.real
          ? pass(`--header-h ${hdr.token}px ≥ header ${hdr.real.toFixed(1)}px`)
          : fail(`--header-h ${hdr.token}px < rendered header ${hdr.real.toFixed(1)}px`);
      }
    }

    // 8 · typography: real line boxes via Range.getClientRects()
    const typo = await pg.evaluate(() => {
      const problems = [];
      const lineCount = (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        // merge client rects into visual line boxes by vertical overlap,
        // not rect.top — a <small>/<strong> on one line has a different top
        const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
        const lines = [];
        rects.forEach((r) => {
          const hit = lines.find((L) => r.top < L.bottom - 2 && r.bottom > L.top + 2);
          if (hit) { hit.top = Math.min(hit.top, r.top); hit.bottom = Math.max(hit.bottom, r.bottom); hit.rects.push(r); }
          else lines.push({ top: r.top, bottom: r.bottom, rects: [r] });
        });
        return lines;
      };
      document.querySelectorAll('h1,h2,h3').forEach((el) => {
        if (!el.textContent.trim() || el.textContent.split(/\s+/).length < 3) return;
        if (getComputedStyle(el).display === 'none') return;
        const lines = lineCount(el);
        if (lines.length >= 2) {
          const last = lines[lines.length - 1];
          const lastWidth = Math.max(...last.rects.map((r) => r.width));
          const maxWidth = Math.max(...lines.map((L) => Math.max(...L.rects.map((r) => r.width))));
          // a last line under 18% of the block width usually means one word
          if (lastWidth < maxWidth * 0.18) {
            problems.push(`possible widow in <${el.tagName.toLowerCase()}> "${el.textContent.trim().slice(0, 40)}"`);
          }
        }
      });
      return problems;
    });
    typo.length === 0 ? pass('no heading widows detected') : typo.forEach((t) => console.log(`  warn  ${t}`));

    // 9 · form behaviour (index only — smile-makeover uses a calendar now)
    if (page === 'index.html' && (width === 375 || width === 1280)) {
      // validation blocks an empty step
      await pg.click('#btn-next');
      const err1 = await pg.evaluate(() => document.getElementById('err-step-1').classList.contains('show'));
      err1 ? pass('empty step blocked with error') : fail('empty step not blocked');

      // pointer selection advances (after the 260ms beat) — centre the
      // option first so the fixed header can't swallow the click
      await pg.evaluate(() =>
        document.querySelector('.q-option input[name="situation"]').scrollIntoView({ block: 'center' }));
      await pg.waitForTimeout(100);
      await pg.click('.q-option input[name="situation"]', { force: true });
      await pg.waitForTimeout(500);
      let step = await pg.evaluate(() => document.getElementById('step-counter').textContent);
      step.includes('2') ? pass('pointer selection auto-advances') : fail(`pointer select did not advance (${step})`);

      // arrow keys do NOT advance
      await pg.focus('input[name="timing"]');
      await pg.keyboard.press('ArrowDown');
      await pg.waitForTimeout(500);
      step = await pg.evaluate(() => document.getElementById('step-counter').textContent);
      step.includes('2') ? pass('arrow-key selection does not auto-advance') : fail('arrow key advanced the step');

      // Continue moves keyboard users on; back preserves answers
      await pg.click('#btn-next');
      step = await pg.evaluate(() => document.getElementById('step-counter').textContent);
      step.includes('3') ? pass('Continue advances after keyboard selection') : fail('Continue did not advance');
      await pg.click('#btn-back');
      await pg.click('#btn-back');
      const preserved = await pg.evaluate(() => {
        const el = document.querySelector('input[name="situation"]:checked');
        return el && el.value;
      });
      preserved ? pass('back navigation preserves answers') : fail(`answer lost on back (${preserved})`);

      // errors clear on input
      await pg.click('#btn-next'); await pg.waitForTimeout(50);
      await pg.click('#btn-next'); await pg.waitForTimeout(50);
      await pg.click('#btn-next'); // step 3 empty → errors
      const invalidBefore = await pg.evaluate(() => document.querySelectorAll('[aria-invalid="true"]').length);
      await pg.fill('#f-first', 'Jane');
      const cleared = await pg.evaluate(() => document.getElementById('f-first').getAttribute('aria-invalid'));
      invalidBefore >= 4 && cleared !== 'true'
        ? pass('field errors set with aria-invalid and clear on input')
        : fail(`error lifecycle wrong (invalid=${invalidBefore}, cleared=${cleared})`);
    }

    // 9a · calendar pop-up behaviour (smile-makeover: form replaced by calendar)
    if (page === 'smile-makeover.html' && (width === 375 || width === 1280)) {
      const heroCal = await pg.evaluate(() => !!document.getElementById('oEO233PEbSHpRFqkzXwG_hero'));
      heroCal ? pass('hero booking calendar present') : fail('hero calendar missing');

      let modalHidden = await pg.evaluate(() => document.getElementById('cal-modal').hidden);
      modalHidden ? pass('calendar pop-up starts hidden') : fail('calendar pop-up not hidden at load');

      // a CTA opens the pop-up and lazy-loads the calendar iframe
      await pg.evaluate(() => document.querySelector('a.btn[href="#book"]').click());
      await pg.waitForTimeout(120);
      const opened = await pg.evaluate(() =>
        !document.getElementById('cal-modal').hidden &&
        !!document.getElementById('cal-modal-embed').querySelector('iframe'));
      opened ? pass('CTA opens calendar pop-up and loads iframe') : fail('CTA did not open calendar');

      // Escape closes it again
      await pg.keyboard.press('Escape');
      await pg.waitForTimeout(120);
      modalHidden = await pg.evaluate(() => document.getElementById('cal-modal').hidden);
      modalHidden ? pass('Escape closes calendar pop-up') : fail('Escape did not close pop-up');
    }

    // 9b · before/after must actually swap pixels at the extremes —
    // a stacking bug once passed every computed-style check
    if (page === 'index.html' && width === 1280) {
      const ba = pg.locator('.ba-frame').first();
      await pg.evaluate(() => {
        const el = document.querySelector('.ba');
        el.dataset.touched = '1';
        el.style.setProperty('--pos', '0%');
      });
      await pg.waitForTimeout(150);
      const shotAfter = await ba.screenshot();
      await pg.evaluate(() => document.querySelector('.ba').style.setProperty('--pos', '100%'));
      await pg.waitForTimeout(150);
      const shotBefore = await ba.screenshot();
      !shotAfter.equals(shotBefore)
        ? pass('before/after layers render different images')
        : fail('before/after slider shows the same image at both extremes');
    }

    // 10 · screenshot as well as measure — in a reduced-motion context so
    // every element sits in its finished state (proving that path too), with
    // the fixed header made absolute so fullPage stitching can't smear it.
    if (width === 375 || width === 1280) {
      const rmCtx = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
      });
      const rmPg = await rmCtx.newPage();
      await stubNetwork(rmPg);
      await rmPg.goto(pathToFileURL(join(root, page)).href, { waitUntil: 'load' });
      await rmPg.addStyleTag({ content: '.site-header{position:absolute !important} .sticky-bar{display:none !important}' });
      await rmPg.waitForTimeout(300);
      const name = `${page.replace(/[\/.]/g, '-')}-${width}.png`;
      await rmPg.screenshot({ path: join(shotDir, name), fullPage: true });
      pass(`screenshot ${name}`);
      // reduced-motion must yield finished states: nothing left at opacity 0
      const hiddenAnims = await rmPg.evaluate(() =>
        [...document.querySelectorAll('.anim, .mask-word > span')]
          .filter((el) => getComputedStyle(el).opacity === '0').length
      );
      hiddenAnims === 0
        ? pass('reduced-motion shows finished states')
        : fail(`${hiddenAnims} elements hidden under reduced motion`);
      await rmCtx.close();
    }

    await ctx.close();
  }
}

// 11 · cookie consent: every funnel page carries the current banner, and nothing
// optional (Google map, marketing tags) runs before the visitor allows it
{
  console.log('\n== cookie consent ==');
  const stamp = spawnSync(process.execPath, [join(root, 'scripts/stamp-consent.mjs'), '--check'], { encoding: 'utf8' });
  stamp.status === 0 ? pass('consent block in sync on every funnel page') : fail(`consent block out of date — run node scripts/stamp-consent.mjs\n${stamp.stderr}`);
  for (const page of ['index.html', 'smile-makeover.html', 'thank-you.html', 'smile-thank-you.html']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    const errors = [];
    pg.on('pageerror', (e) => errors.push(e.message));
    await stubNetwork(pg);
    await pg.goto(pathToFileURL(join(root, page)).href, { waitUntil: 'load' });
    await pg.evaluate(() => localStorage.clear());
    await pg.reload({ waitUntil: 'load' });
    const look = () => pg.evaluate(() => ({
      banner: !document.getElementById('lc-cookies').hidden,
      mapLoaded: [...document.querySelectorAll('iframe[data-consent="maps"]')].some((f) => f.getAttribute('src')),
      maps: document.querySelectorAll('iframe[data-consent="maps"]').length,
      tagsRan: [...document.querySelectorAll('script[type="text/plain"][data-consent]')].every((s) => s.getAttribute('data-ran')),
      tags: document.querySelectorAll('script[type="text/plain"][data-consent]').length,
      ungated: [...document.querySelectorAll('iframe[src*="google.com/maps"]')].filter((f) => !f.hasAttribute('data-consent')).length,
    }));
    let st = await look();
    st.banner ? pass(`${page}: banner shows on first visit`) : fail(`${page}: no banner on first visit`);
    !st.mapLoaded && (st.tags === 0 || !st.tagsRan) && st.ungated === 0
      ? pass(`${page}: nothing optional loads before a choice`) : fail(`${page}: optional content loaded before consent ${JSON.stringify(st)}`);
    await pg.click('.lc-reject');
    st = await look();
    !st.banner && !st.mapLoaded && (st.tags === 0 || !st.tagsRan) ? pass(`${page}: Reject keeps optional content off`) : fail(`${page}: Reject ${JSON.stringify(st)}`);
    await pg.reload({ waitUntil: 'load' });
    st = await look();
    !st.banner ? pass(`${page}: choice remembered`) : fail(`${page}: banner returned after a choice`);
    await pg.click('[data-cookie-settings]');
    const reopened = await pg.evaluate(() => !document.getElementById('lc-cookies').hidden && !document.querySelector('.lc-details').hidden);
    reopened ? pass(`${page}: Cookie settings reopens the choices`) : fail(`${page}: Cookie settings did not reopen`);
    await pg.click('.lc-accept');
    st = await look();
    (st.maps === 0 || st.mapLoaded) && (st.tags === 0 || st.tagsRan) ? pass(`${page}: Accept all loads map and tags`) : fail(`${page}: Accept ${JSON.stringify(st)}`);
    errors.length ? fail(`${page}: page errors ${errors.join(' | ')}`) : pass(`${page}: no page errors`);
    await ctx.close();
  }
}

await browser.close();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
