import type { Page } from '@playwright/test';
import type { BlogContent, BlogLink } from '../types/blog.js';
import { normalizeText } from './check-utils.js';
import { normalizeUrl } from '../blog/url-normalizer.js';

/** Common blog/CMS content container selectors, tried in order. */
const CONTENT_CONTAINER_SELECTORS = [
  'article',
  'main',
  '.post-content',
  '.entry-content',
  '.blog-content',
  '.article-content',
  '#content'
];

/**
 * Extracts the live, published version of a blog post's content from a
 * Playwright Page, using the same normalized BlogContent shape produced by
 * the docx extractor so the two can be compared field-by-field.
 *
 * Heading/bold/link extraction is scoped to the blog's main content
 * container (article/main/…) so navigation, sidebar, footer, and
 * related-post links/bold are excluded — those checks report every
 * unexpected entry found (e.g. "Bold (extra)"), so a wide scope would
 * flood a report with irrelevant site-chrome noise. Paragraph-type content
 * (paragraphs, blockquotes, figure captions) is intentionally NOT scoped
 * the same way: it is only ever matched against the approved document's own
 * paragraphs (never reported as "extra"), and a page's lead/intro
 * text is commonly placed in a header region outside the main content
 * container — so widening its reach costs nothing and avoids false
 * "missing" reports for that content.
 */
export async function extractLiveBlogContent(page: Page): Promise<BlogContent> {
  const scope = await resolveContentScope(page);
  const pageUrl = page.url();

  // Title (H1) is often placed outside the content container in CMS themes,
  // so we try the scoped selector first then fall back to page-wide.
  //
  // Every other query below is independent of the others — none of them
  // depend on each other's result — so they all run as one batch of
  // concurrent Playwright round-trips instead of paying for each one's
  // latency sequentially. Only the H1 fallback (below) has to wait on its
  // own scoped query first, since it only fires when that comes back empty.
  const [
    scopedTitle, h1Count, h2Headings, h3Headings, h4Headings, paragraphs,
    metaTitle, metaDescription, canonicalHref, links, boldPhrases
  ] = await Promise.all([
    extractText(page, `${scope} h1`),
    // Document-wide, not scoped — a duplicate H1 is an SEO defect regardless
    // of whether it sits inside or outside the content container. See the
    // `h1Count` doc comment on BlogContent.
    page.locator('h1').count(),
    extractAllText(page, `${scope} h2, ${scope} [role="heading"][aria-level="2"]`),
    extractAllText(page, `${scope} h3, ${scope} [role="heading"][aria-level="3"]`),
    // Accordion/FAQ widgets (a common WordPress/page-builder pattern) often
    // render their question text as a <button>/<div> with role="heading"
    // and an explicit aria-level instead of a literal <h4> tag — include
    // those so an FAQ heading that genuinely exists isn't missed.
    extractAllText(page, `${scope} h4, ${scope} [role="heading"][aria-level="4"]`),
    extractParagraphContent(page, scope),
    page.title(),
    page.$eval('meta[name="description"]', (el) => el.getAttribute('content')).catch(() => null),
    page.$eval('link[rel="canonical"]', (el) => el.getAttribute('href')).catch(() => null),
    // Links/bold are scoped to the content container only — see the module doc comment.
    extractLinksFromPage(page, scope, pageUrl),
    extractBoldFromPage(page, scope)
  ]);

  const title = scopedTitle ?? (await extractText(page, 'h1'));

  return {
    title:           title ?? undefined,
    h2Headings,
    h3Headings,
    h4Headings,
    paragraphs,
    metaTitle:       normalizeText(metaTitle)           || undefined,
    metaDescription: normalizeText(metaDescription ?? undefined) || undefined,
    links,
    boldPhrases,
    canonicalUrl:    canonicalHref ? new URL(canonicalHref, pageUrl).toString() : undefined,
    h1Count
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function resolveContentScope(page: Page): Promise<string> {
  for (const selector of CONTENT_CONTAINER_SELECTORS) {
    if (await page.locator(selector).count() > 0) return selector;
  }
  return 'body';
}

// Both helpers below read `textContent` rather than Playwright's
// visibility-aware `innerText()` — matching how links/bold are already
// extracted (see extractLinksFromPage/extractBoldFromPage). Content inside a
// collapsed accordion panel, an inactive tab, or anything else hidden by
// CSS/JS until a user interacts with it is still genuinely approved content;
// `innerText()` silently omits it (it mirrors rendered layout), which would
// make it look "missing" even though it exists verbatim in the page's HTML.

async function extractText(page: Page, selector: string): Promise<string | null> {
  const text = await page.$eval(selector, (el) => el.textContent ?? '').catch(() => null);
  return text ? normalizeText(text) : null;
}

async function extractAllText(page: Page, selector: string): Promise<string[]> {
  const texts = await page.$$eval(selector, (els) => els.map((el) => el.textContent ?? ''));
  return texts.map((t) => normalizeText(t)).filter((t) => t !== '');
}

/**
 * Extracts every paragraph-equivalent piece of body text: `<p>` paragraphs,
 * `<blockquote>` quoted passages, and `<figcaption>` image captions
 * (page-wide — see the scoping note on extractLiveBlogContent), plus `<li>`
 * list items (scoped to the content container, since `<li>` is also the
 * building block of nav menus/footers and scoping it avoids treating those
 * as blog content). Returned in document order via a single combined query,
 * so mixed layouts (a paragraph immediately followed by a list, an
 * introductory paragraph before the first heading, a blockquote between two
 * paragraphs, …) preserve their real relative order for the "moved" check.
 */
async function extractParagraphContent(page: Page, scope: string): Promise<string[]> {
  const selector = `p, blockquote, figcaption, ${scope} li`;
  const texts = await page.$$eval(selector, (els) => els.map((el) => el.textContent ?? ''));
  return texts.map((t) => normalizeText(t)).filter((t) => t !== '');
}

async function extractLinksFromPage(page: Page, scope: string, pageUrl: string): Promise<BlogLink[]> {
  type RawLink = { text: string; rawUrl: string };

  const rawLinks: RawLink[] = await page.$$eval(
    `${scope} a[href]`,
    (els) =>
      (els as HTMLAnchorElement[])
        .map((el) => ({
          text:   (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
          rawUrl: el.getAttribute('href') ?? ''
        }))
        .filter((l) => l.text !== '' && l.rawUrl !== '')
  );

  return rawLinks
    .filter((l) => !/^(#|mailto:|tel:|javascript:)/i.test(l.rawUrl.trim()))
    .map((l) => ({
      text:   normalizeText(l.text),
      url:    normalizeUrl(l.rawUrl, pageUrl),
      rawUrl: l.rawUrl
    }));
}

async function extractBoldFromPage(page: Page, scope: string): Promise<string[]> {
  const texts: string[] = await page.$$eval(
    `${scope} strong, ${scope} b`,
    (els) =>
      (els as HTMLElement[])
        .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
        .filter((t) => t !== '')
  );

  return texts.map((t) => normalizeText(t));
}
