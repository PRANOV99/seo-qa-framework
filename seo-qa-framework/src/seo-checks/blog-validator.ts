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
 * Extraction is scoped to the blog's main content container (article/main/…)
 * so navigation, sidebar, footer, and related-post links/bold are excluded.
 */
export async function extractLiveBlogContent(page: Page): Promise<BlogContent> {
  const scope = await resolveContentScope(page);
  const pageUrl = page.url();

  // Title (H1) is often placed outside the content container in CMS themes,
  // so we try the scoped selector first then fall back to page-wide.
  const [scopedTitle, h2Headings, h3Headings, h4Headings, paragraphs, metaTitle, metaDescription, canonicalHref] =
    await Promise.all([
      extractText(page, `${scope} h1`),
      extractAllText(page, `${scope} h2, ${scope} [role="heading"][aria-level="2"]`),
      extractAllText(page, `${scope} h3, ${scope} [role="heading"][aria-level="3"]`),
      // Accordion/FAQ widgets (a common WordPress/page-builder pattern) often
      // render their question text as a <button>/<div> with role="heading"
      // and an explicit aria-level instead of a literal <h4> tag — include
      // those so an FAQ heading that genuinely exists isn't missed.
      extractAllText(page, `${scope} h4, ${scope} [role="heading"][aria-level="4"]`),
      extractAllText(page, `${scope} p`),
      page.title(),
      page.$eval('meta[name="description"]', (el) => el.getAttribute('content')).catch(() => null),
      page.$eval('link[rel="canonical"]', (el) => el.getAttribute('href')).catch(() => null)
    ]);

  const title = scopedTitle ?? (await extractText(page, 'h1'));

  // ── Links — extracted within the content scope only ───────────────────────
  const links = await extractLinksFromPage(page, scope, pageUrl);

  // ── Bold phrases — extracted within the content scope only ────────────────
  const boldPhrases = await extractBoldFromPage(page, scope);

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
    canonicalUrl:    canonicalHref ? new URL(canonicalHref, pageUrl).toString() : undefined
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function resolveContentScope(page: Page): Promise<string> {
  for (const selector of CONTENT_CONTAINER_SELECTORS) {
    if (await page.locator(selector).count() > 0) return selector;
  }
  return 'body';
}

async function extractText(page: Page, selector: string): Promise<string | null> {
  const text = await page.locator(selector).first().innerText().catch(() => null);
  return text ? normalizeText(text) : null;
}

async function extractAllText(page: Page, selector: string): Promise<string[]> {
  return (await page.locator(selector).allInnerTexts())
    .map((t) => normalizeText(t))
    .filter((t) => t !== '');
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
