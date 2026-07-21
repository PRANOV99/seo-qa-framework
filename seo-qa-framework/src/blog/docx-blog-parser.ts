import * as mammoth from 'mammoth';
import type { BlogContent, BlogLink } from '../types/blog.js';
import { normalizeText } from '../seo-checks/check-utils.js';
import { normalizeUrl } from './url-normalizer.js';

// ── Label-detection regexes ────────────────────────────────────────────────────
const META_TITLE_LABEL       = /^meta\s*title\s*[:-]\s*(.*)$/i;
const META_DESCRIPTION_LABEL = /^meta\s*description\s*[:-]\s*(.*)$/i;
const H1_LABEL = /^(?:h1|blog\s*title|page\s*title|article\s*title|title)\s*[:-]\s*(.*)$/i;

// Metadata-only fields that must be stripped from the body paragraph list
const METADATA_LABEL = /^(?:seo\s*slug|slug|canonical|redirect|author|category|tags?|published|date|focus\s*keyword|primary\s*keyword|schema|robots|noindex|url|permalink|alt\s*text)\s*[:-]/i;

// Formatting-only paragraphs (dividers, empty lines, etc.)
const FORMATTING_ONLY = /^[-=*_\s|]{0,10}$/;

interface Block {
  tag: 'h1' | 'h2' | 'h3' | 'p' | 'table';
  /** Raw inner HTML of the block as produced by mammoth. */
  innerHtml: string;
}

interface LabeledFields {
  metaTitle?: string;
  metaDescription?: string;
  h1?: string;
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

    // Skip labeled metadata fields (already captured) and pure formatting lines
    if (isAnyLabeledField(text) || FORMATTING_ONLY.test(text)) continue;

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
    metaTitle:       labeledFields.metaTitle       || undefined,
    metaDescription: labeledFields.metaDescription || undefined,
    links,
    boldPhrases
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
  if (h1m) { fields.h1              = fields.h1              ?? normalizeText(h1m[1] ?? ''); }
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

function htmlToText(html: string): string {
  return normalizeText(decodeHtmlEntities(html.replace(/<[^>]+>/g, ' ')));
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g,  ' ')
    .replace(/&amp;/g,   '&')
    .replace(/&lt;/g,    '<')
    .replace(/&gt;/g,    '>')
    .replace(/&quot;/g,  '"')
    .replace(/&#39;/g,   "'");
}
