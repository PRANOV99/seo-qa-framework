import * as mammoth from 'mammoth';
import type { BlogContent, BlogLink } from '../types/blog.js';
import { normalizeText } from '../seo-checks/check-utils.js';
import { normalizeUrl } from './url-normalizer.js';

// ── Label-detection regexes ────────────────────────────────────────────────────
const META_TITLE_LABEL       = /^meta\s*title\s*[:-]\s*(.*)$/i;
const META_DESCRIPTION_LABEL = /^meta\s*description\s*[:-]\s*(.*)$/i;
const H1_LABEL = /^(?:h1|blog\s*title|page\s*title|article\s*title|title)\s*[:-]\s*(.*)$/i;
const CANONICAL_LABEL = /^canonical\s*[:-]\s*(.*)$/i;
const SLUG_LABEL      = /^(?:seo\s*slug|slug|permalink|url)\s*[:-]\s*(.*)$/i;

// Metadata-only fields that must be stripped from the body paragraph list
const METADATA_LABEL = /^(?:seo\s*slug|slug|canonical|redirect|author|category|tags?|published|date|focus\s*keyword|primary\s*keyword|schema|robots|noindex|url|permalink|alt\s*text)\s*[:-]/i;

// Zero-width / invisible characters that render as nothing: zero-width
// space/non-joiner/joiner, word joiner, the Mongolian vowel separator, and
// the zero-width no-break space (BOM used mid-text). A paragraph consisting
// only of these (plus whitespace) carries no visible content at all, so they
// are stripped entirely before testing whether a line is a divider — a
// single stray zero-width character would otherwise defeat a plain
// character-class match against an otherwise all-dashes line.
// Each code point is an intentional literal member of the class (incl. the
// zero-width joiner U+200D itself), not an accidental combining/joiner
// sequence — hence the lint disable below.
// eslint-disable-next-line no-misleading-character-class
const INVISIBLE_CHARS = new RegExp('[\\u200B\\u200C\\u200D\\u2060\\u180E\\uFEFF]', 'g');

// Decorative separator/divider lines content writers place before metadata
// sections (e.g. "------", "______", "======", "******", "~~~~~~~~~~~~") —
// any length, never real content, any mix of these characters. Includes the
// common Unicode dash variants (en/em dash, minus sign, etc.) in case Word's
// autocorrect or a copy-paste substitutes one, and straight/curly quote
// marks, since a divider is sometimes typed or pasted wrapped in quotes.
// Matched whenever the ENTIRE trimmed paragraph (after stripping invisible
// characters) consists solely of these characters, including whitespace, so
// a divider surrounded by stray spaces is still recognised.
const DIVIDER_CHARS =
  '\\-=*_~|"\'' +
  '\\u2010\\u2011\\u2012\\u2013\\u2014\\u2015\\u2212\\uFE58\\uFE63\\uFF0D' + // Unicode dash variants
  '\\u2018\\u2019\\u201A\\u201B\\u201C\\u201D\\u201E\\u201F' +               // curly quote variants
  '\\s';
const DIVIDER_ONLY = new RegExp(`^[${DIVIDER_CHARS}]+$`);

/**
 * Detects a paragraph that is nothing but a decorative divider — or nothing
 * but invisible characters — so it never leaks through as fake blog content.
 * Hidden characters are stripped before testing since they're invisible to
 * whoever wrote the document and would otherwise silently defeat the
 * character-class match (e.g. a lone zero-width space hiding among a line
 * of dashes). Exported for direct unit testing.
 */
export function isDividerOnly(rawText: string): boolean {
  const visible = rawText.replace(INVISIBLE_CHARS, '');
  if (visible.trim() === '') return true;
  return DIVIDER_ONLY.test(visible);
}

interface Block {
  tag: 'h1' | 'h2' | 'h3' | 'p' | 'table';
  /** Raw inner HTML of the block as produced by mammoth. */
  innerHtml: string;
}

interface LabeledFields {
  metaTitle?: string;
  metaDescription?: string;
  h1?: string;
  canonical?: string;
  slug?: string;
}

/**
 * Parses an approved blog .docx into the normalized BlogContent shape.
 *
 * Extraction rules:
 *  - Word "Heading 1/2/3" styles → title / h2Headings / h3Headings
 *  - Labeled paragraphs ("Meta Title: …", "H1: …", etc.) → metadata fields
 *  - Metadata-only lines (SEO Slug, Category, Tags, dividers, empty) are
 *    silently discarded and never included in paragraphs[], links, or boldPhrases.
 *  - <a href="…"> tags from body paragraphs → links[]
 *  - <strong>/<b> tags from body paragraphs and headings → boldPhrases[]
 *
 * @param filePath  Path to the .docx file.
 * @param pageUrl   The live blog URL — used to resolve any relative hrefs that
 *                  may appear in the document (Word usually stores absolute
 *                  URLs, so this is a safety net).
 */
export async function parseBlogDocx(filePath: string, pageUrl = ''): Promise<BlogContent> {
  const { value: html } = await mammoth.convertToHtml({ path: filePath });
  const blocks = extractBlocks(html);

  const labeledFields = extractLabeledFields(blocks);
  const paragraphs: string[] = [];
  const links: BlogLink[]    = [];
  const boldPhrases: string[] = [];

  let title: string | undefined = labeledFields.h1;
  const h2Headings: string[] = [];
  const h3Headings: string[] = [];

  for (const block of blocks) {
    const text = htmlToText(block.innerHtml);

    if (!text) continue;

    // Skip labeled metadata fields (already captured) and decorative divider lines
    if (isAnyLabeledField(text) || isDividerOnly(text)) continue;

    if (block.tag === 'h1') {
      title = title ?? text;
      // Bold inside an H1 is intentional (rare but possible)
      boldPhrases.push(...extractBoldFromHtml(block.innerHtml));
    } else if (block.tag === 'h2') {
      h2Headings.push(text);
      boldPhrases.push(...extractBoldFromHtml(block.innerHtml));
    } else if (block.tag === 'h3') {
      h3Headings.push(text);
      boldPhrases.push(...extractBoldFromHtml(block.innerHtml));
    } else if (block.tag === 'p') {
      paragraphs.push(text);
      links.push(...extractLinksFromHtml(block.innerHtml, pageUrl));
      boldPhrases.push(...extractBoldFromHtml(block.innerHtml));
    }
  }

  return {
    title: title || undefined,
    h2Headings,
    h3Headings,
    paragraphs,
    metaTitle:            labeledFields.metaTitle       || undefined,
    metaDescription:      labeledFields.metaDescription || undefined,
    links,
    boldPhrases,
    expectedCanonicalUrl: labeledFields.canonical || undefined,
    expectedSlug:         labeledFields.slug      || undefined
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function isAnyLabeledField(text: string): boolean {
  return (
    META_TITLE_LABEL.test(text)       ||
    META_DESCRIPTION_LABEL.test(text) ||
    H1_LABEL.test(text)               ||
    METADATA_LABEL.test(text)
  );
}

function extractLabeledFields(blocks: readonly Block[]): LabeledFields {
  const fields: LabeledFields = {};
  for (const block of blocks) {
    if (block.tag === 'table') { applyTableRows(block.innerHtml, fields); continue; }
    applyLabeledLine(htmlToText(block.innerHtml), fields);
  }
  return fields;
}

function applyLabeledLine(text: string, fields: LabeledFields): void {
  const mtm = META_TITLE_LABEL.exec(text);
  if (mtm) { fields.metaTitle       = fields.metaTitle       ?? normalizeText(mtm[1] ?? ''); return; }
  const mdm = META_DESCRIPTION_LABEL.exec(text);
  if (mdm) { fields.metaDescription = fields.metaDescription ?? normalizeText(mdm[1] ?? ''); return; }
  const h1m = H1_LABEL.exec(text);
  if (h1m) { fields.h1              = fields.h1              ?? normalizeText(h1m[1] ?? ''); return; }
  const canm = CANONICAL_LABEL.exec(text);
  if (canm) { fields.canonical      = fields.canonical       ?? normalizeText(canm[1] ?? ''); return; }
  const slugm = SLUG_LABEL.exec(text);
  if (slugm) { fields.slug          = fields.slug            ?? normalizeText(slugm[1] ?? ''); }
}

function applyTableRows(tableHtml: string, fields: LabeledFields): void {
  for (const rowMatch of tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowContent = rowMatch[1];
    if (rowContent === undefined) continue;
    const cells = [...rowContent.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((cm) => htmlToText(cm[1] ?? ''));
    if (cells.length < 2) continue;
    const [label, value] = cells;
    if (label === undefined || value === undefined) continue;
    const normLabel = normalizeText(label).toLowerCase();
    if (normLabel === 'meta title' || normLabel === 'metatitle') {
      fields.metaTitle = fields.metaTitle ?? value;
    } else if (normLabel === 'meta description' || normLabel === 'metadescription') {
      fields.metaDescription = fields.metaDescription ?? value;
    } else if (['h1', 'blog title', 'page title', 'article title', 'title'].includes(normLabel)) {
      fields.h1 = fields.h1 ?? value;
    } else if (normLabel === 'canonical') {
      fields.canonical = fields.canonical ?? value;
    } else if (['seo slug', 'slug', 'permalink', 'url'].includes(normLabel)) {
      fields.slug = fields.slug ?? value;
    }
  }
}

function extractBlocks(html: string): Block[] {
  const blocks: Block[] = [];
  for (const match of html.matchAll(/<(h1|h2|h3|p|table)[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const tagName   = match[1];
    const innerHtml = match[2];
    if (tagName === undefined || innerHtml === undefined) continue;
    blocks.push({ tag: tagName.toLowerCase() as Block['tag'], innerHtml });
  }
  return blocks;
}

/** Extracts hyperlinks from a block's inner HTML. */
function extractLinksFromHtml(innerHtml: string, baseUrl: string): BlogLink[] {
  const links: BlogLink[] = [];
  for (const match of innerHtml.matchAll(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const rawUrlEncoded = match[1] ?? '';
    const linkHtml      = match[2] ?? '';
    if (!rawUrlEncoded) continue;
    // Decode HTML entities that mammoth may have encoded in the href
    // (e.g. & → &amp; in attribute values).
    const rawUrl = decodeHtmlEntities(rawUrlEncoded);
    // Skip non-navigational hrefs
    if (/^(mailto:|tel:|javascript:|#)/.test(rawUrl.trim())) continue;
    const text = normalizeText(htmlToText(linkHtml));
    if (!text) continue;
    links.push({ text, url: normalizeUrl(rawUrl, baseUrl), rawUrl });
  }
  return links;
}

/** Extracts bold phrases from a block's inner HTML. */
function extractBoldFromHtml(innerHtml: string): string[] {
  const phrases: string[] = [];
  for (const match of innerHtml.matchAll(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi)) {
    const text = normalizeText(htmlToText(match[1] ?? ''));
    if (text) phrases.push(text);
  }
  return phrases;
}

/**
 * Converts a fragment of HTML into its rendered plain-text content: every
 * tag (however deeply nested — `<span>`, `<strong>`, `<b>`, `<em>`, `<i>`,
 * `<a>`, …) is stripped, HTML entities are decoded, and whitespace is
 * normalized. Exported for direct unit testing of entity/tag handling.
 *
 * Formatting tags are zero-width wrappers around text that already contains
 * whatever real spaces the source document had, so they're stripped to
 * nothing rather than a space — otherwise a bold/italic/link run that starts
 * or ends mid-word (e.g. "Infra" bolded right up against an apostrophe:
 * "Infra's") would gain a phantom space at the tag boundary ("Infra 's").
 * `<br>` is the one exception: it is a genuine line-break/word-separator, so
 * it's turned into a space rather than dropped.
 */
export function htmlToText(html: string): string {
  return normalizeText(decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
  ));
}

/**
 * Decodes HTML entities: the handful of named entities mammoth/browsers
 * commonly produce, plus ANY numeric character reference (decimal, e.g.
 * `&#8217;` → ’, or hex, e.g. `&#x2019;` → ’) — covering typographic quotes,
 * dashes, ellipses, and anything else that shows up encoded rather than as
 * a raw Unicode character. Exported for direct unit testing.
 */
export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g,  ' ')
    .replace(/&amp;/g,   '&')
    .replace(/&lt;/g,    '<')
    .replace(/&gt;/g,    '>')
    .replace(/&quot;/g,  '"')
    .replace(/&#(\d+);/g,            (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/gi, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)));
}
