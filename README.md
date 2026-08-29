# Lushington Road Dental Practice — Dental Implant Funnel

Lead-generation landing funnel for the Eastbourne dental implant campaign
(complimentary consultation + OPG X-ray offer). Built to the design prompt
pack's house rules: each page is a single self-contained HTML file — no
framework, no build step, no external JS, inline SVG only, mobile-first,
WCAG AA measured rather than assumed.

## Pages

| File | Purpose |
| --- | --- |
| `index.html` | The funnel: sticky header with scroll-spy nav and progress bar, hero with the three-step qualifier form (Gilded Hairline treatment), dark trust band with stat strip, problem cards, pricing, before/after sliders, review marquee, reassurance band, journey, team roster, what's-included, FAQ accordion, final CTA with map, sticky mobile CTA bar. |
| `thank-you.html` | Post-submission confirmation: tick-draw band, what-happens-next steps, call band, pre-call prompts, social proof. Holds the **only** conversion tag block — never fire the conversion on submit as well. Permanently `noindex`. |
| `labs/tokens.html` | Token foundation swatch sheet. Every text/background pair's contrast ratio is computed live from relative luminance; includes three complete alternative palettes swappable as one block. |
| `verify.mjs` | Playwright harness — all pages at 360/375/414/768/1024/1280/1440: overflow, console/page errors, image alts, single h1, dead/bracketed hrefs, JSON-LD, dark-band contrast, `--header-h` vs the rendered header, heading widows, the full form behaviour contract, reduced-motion finished states, and full-page screenshots. |
| `build.mjs` | Deployment build → `dist/`: inlines `assets/` images as data URIs and prints everything still unresolved before publish. |

## Run the checks

```sh
npm install          # playwright-core only
node verify.mjs      # uses the pre-installed Chromium at /opt/pw-browsers
node build.mjs       # writes dist/ and prints the pre-publish checklist
```

## Before publish — all of it highlighted in yellow on the pages

`node build.mjs` prints the authoritative list. In short:

1. **Phone number** — every `[01323 000 000]` placeholder (header, final CTA, thank-you call band).
2. **Photography** — drop content-shoot images into `assets/` using the
   filenames shown on each striped slot, and add the `<img>` tags per the
   comment in the hero (the labelled slots are the no-JS fallback layer).
3. **Reviews** — replace all placeholder review cards with verbatim Google
   reviews (names with permission).
4. **Team** — implant surgeon's name/bio/GDC number; Anjali Esack's bio;
   GDC/CQC details in the footer.
5. **CRM wiring** — post the lead to the practice's LeadConnector/GHL
   endpoint in the marked `CRM INTEGRATION BLOCK` in `index.html`
   (`submitLead()`). The onboarding pack's QA form reference is noted there.
6. **Conversion tag** — paste the Meta Pixel / Google Ads snippet into the
   marked block in `thank-you.html` `<head>` only.
7. Once 1–6 are done, remove the `noindex` meta from `index.html`
   (`thank-you.html` keeps its `noindex` forever).

## Design system notes

- Palette: built around the website brand pink `#F06EAA` — deep plum
  bands `#3B1F30`, blush-ivory ground `#FAF3F5`, deep raspberry CTAs
  `#A02D64` on light grounds, the brand pink itself as the CTA and
  flourish on dark bands, champagne gold `#D9A662` reserved for review
  stars. The previous green/gold scheme is kept as alternate palette B
  in the token lab.
- `--cta-on-dark` (the brand pink) measures 5.28:1 against the plum band
  with 5.28:1 text on it — proven in `labs/tokens.html`, re-checked by
  `verify.mjs`.
- Typography: Cormorant Garamond (600/700) for headings, Mulish for body
  and buttons, loaded from Google Fonts with serif/sans system fallbacks.
- Motion: one pattern per section. Word-rise hero headline (masks built
  from live text at runtime), card cascades, calm-drift blooms weighted to
  band bases, count-up stats, tick draw on the thank-you page.
  `prefers-reduced-motion` yields finished states, never faster animation.
- Qualifier form auto-advances on pointer input only (~260ms beat);
  keyboard users get the Continue button; Enter advances rather than
  submitting; honeypot field included.

The remaining prompt-pack labs (background motion, section cuts, funnel
blocks, form treatments, 27-pattern motion lab) are internal reference
pages; the decisions they exist to make are already baked into the funnel
and documented inline. Build them from PROMPTPACK.md P2/P3/P4/P6/P7 if the
team wants the browsable references.
