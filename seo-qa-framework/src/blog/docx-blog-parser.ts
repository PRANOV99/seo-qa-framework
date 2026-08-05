import * as mammoth from 'mammoth';
import type { BlogContent, BlogLink } from '../types/blog.js';
import { normalizeText } from '../seo-checks/check-utils.js';
import { normalizeUrl } from './url-normalizer.js';

// ── Metadata label recognition ──────────────────────────────────────────────────
//
// A single source of truth for every label a content brief might use for a
// given metadata field, regardless of capitalization, punctuation, or minor
// typos ("Met Description" for "Meta Description"). Each pattern is an
// alternation (no anchors/flags of its own) plugged into the anchored/
// unanchored regexes built below.

/** Labels that populate a specific BlogContent field, with all recognized synonyms. */
const LABEL_PATTERNS: Record<'metaTitle' | 'metaDescription' | 'h1' | 'canonical' | 'slug', string> = {
  metaTitle:       'meta\\s*title',
  metaDescription: '(?:met\\s*description|meta\\s*description|description)',
  h1:              '(?:h1|blog\\s*title|page\\s*title|article\\s*title|title)',
  canonical:       'canonical(?:\\s*url)?',
  slug:            '(?:seo\\s*slug|slug|permalink|url)'
};

/**
 * Recognized metadata labels that must be stripped from paragraphs/bold, but
 * have no corresponding BlogContent field — there's nothing on the live page
 * to compare them against (they're content-authoring aids only).
 */
const UNCAPTURED_METADATA_LABELS =
  'focus\\s*keyword|primary\\s*keyword|alt\\s*text|redirect|author|category|tags?|published|date|schema|robots|noindex';

/** Every recognized label, for building "is this line/phrase a metadata label" tests. */
const ALL_LABELS = [...Object.values(LABEL_PATTERNS), UNCAPTURED_METADATA_LABELS].join('|');

/** Colon, hyphen, en dash, or em dash — whichever separator a content writer used between a label and its value. */
const LABEL_SEPARATOR = '[:\\-\\u2013\\u2014]';

/** Matches a metadata label at the very start of a line (used to exclude the whole line from paragraphs/headings). */
const ANY_LABEL_LINE = new RegExp(`^\\s*(?:${ALL_LABELS})\\s*${LABEL_SEPARATOR}`, 'i');

/**
 * Matches the start of a (different) recognized label — either at the very
 * start of the string, or preceded by whitespace — used to stop a label's
 * captured value before it runs into the next label, for the rare case
 * where two labels end up on the same physical line (e.g. "Canonical:
 * https://... Focus Keyword: something" with no line break between them at
 * all). Requiring whitespace (not just any position) before the label is
 * essential: without it, this matches label words as mid-string substrings
 * of the value itself — a URL slug containing "slug", "url", "tag",
 * "date", etc. as one of its hyphenated words (e.g.
 * "my-post-slug-2026") would otherwise get silently truncated right there,
 * since a hyphen is itself a recognized label separator.
 */
const NEXT_LABEL_START = new RegExp(`(?:^|\\s)(?:${ALL_LABELS})\\s*${LABEL_SEPARATOR}`, 'i');

/** A phrase that is JUST a metadata label (optionally with its trailing separator) and nothing else — used to keep labels out of bold validation. */
const METADATA_LABEL_PHRASE = new RegExp(`^\\s*(?:${ALL_LABELS})\\s*${LABEL_SEPARATOR}?\\s*$`, 'i');

/** Precompiled "label + separator" regex per capturable field, anchored to the start of a line. */
const LABEL_LINE_REGEXES: ReadonlyArray<{ key: keyof LabeledFields; regex: RegExp }> =
  (Object.entries(LABEL_PATTERNS) as Array<[keyof LabeledFields, string]>).map(([key, pattern]) => ({
    key,
    regex: new RegExp(`^\\s*(?:${pattern})\\s*${LABEL_SEPARATOR}\\s*`, 'i')
  }));

/** Precompiled "label, and nothing else" regex per capturable field — used for table-cell labels, which are already isolated from their value by column. */
const LABEL_FULL_REGEXES: ReadonlyArray<{ key: keyof LabeledFields; regex: RegExp }> =
  (Object.entries(LABEL_PATTERNS) as Array<[keyof LabeledFields, string]>).map(([key, pattern]) => ({
    key,
    regex: new RegExp(`^(?:${pattern})$`, 'i')
  }));

function isAnyLabeledField(text: string): boolean {
  return ANY_LABEL_LINE.test(text);
}

function isMetadataLabelPhrase(text: string): boolean {
  return METADATA_LABEL_PHRASE.test(text);
}

// ── Heading-level suffix recognition ────────────────────────────────────────────

/**
 * A trailing "(H1)".."(H4)" or "- H1".."- H4" annotation some content briefs
 * use to mark a heading's level directly in its visible text — often on a
 * FAQ question that's otherwise just a plain paragraph, e.g. "What is X?
 * (H4)" or a real Word heading's own text, e.g. "Blog Title - H1" — any
 * spacing inside the parens or around the dash, any hyphen/en dash/em dash,
 * case-insensitive.
 */
const HEADING_LEVEL_SUFFIX = /\s*(?:\(\s*h\s*([1-4])\s*\)|[-–—]\s*h\s*([1-4]))\s*$/i;

/** Detects a trailing "(H1)".."(H4)" / "- H1".."- H4" suffix and returns its level, or undefined if there isn't one. */
function detectHeadingSuffixLevel(text: string): 1 | 2 | 3 | 4 | undefined {
  const match = HEADING_LEVEL_SUFFIX.exec(text);
  if (!match) return undefined;
  return Number(match[1] ?? match[2]) as 1 | 2 | 3 | 4;
}

/** Strips a trailing "(H1)".."(H4)" / "- H1".."- H4" suffix, if present, leaving only the visible heading text. Exported for direct unit testing. */
export function stripHeadingSuffix(text: string): string {
  return text.replace(HEADING_LEVEL_SUFFIX, '').trim();
}

// ── Divider / invisible-character detection (unchanged from before) ────────────

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

// ── Types ────────────────────────────────────────────────────────────────────────

interface Block {
  tag: 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'table' | 'ul' | 'ol';
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

interface HeadingState {
  title?: string;
  h2Headings: string[];
  h3Headings: string[];
  h4Headings: string[];
  /**
   * The document's very first block, when it's a genuine Word Heading 2/3/4
   * style — a last-resort title candidate for documents whose actual blog
   * title was styled Heading 2/3/4 instead of Heading 1 (confirmed against
   * real content-brief docs: the title text sits in an <h3> as the literal
   * first thing in the document, with no "Title:"/"H1:" label anywhere).
   * Deliberately restricted to block index 0 — a genuine, incidental H2/H3
   * section heading elsewhere in an otherwise normal document (no real H1,
   * but real section structure) must NOT be mistaken for the title just
   * because there's no H1; only a heading claiming the very first position
   * in the document carries that signal. Only ever consumed as a fallback
   * when there's no real H1, no h1-labeled line, AND the document has real
   * paragraph content elsewhere (see the assembly code below) — removed
   * from its own level's array at that point so the same text isn't
   * independently checked twice (once as the title, once as a numbered
   * heading it no longer is on the live page).
   */
  firstBlockHeading?: { level: 2 | 3 | 4; text: string };
}

function pushHeading(state: HeadingState, level: 1 | 2 | 3 | 4, text: string): void {
  if (level === 1) state.title = state.title ?? text;
  else if (level === 2) state.h2Headings.push(text);
  else if (level === 3) state.h3Headings.push(text);
  else state.h4Headings.push(text);
}

function tagImpliedLevel(tag: Block['tag']): 1 | 2 | 3 | 4 | undefined {
  if (tag === 'h1') return 1;
  if (tag === 'h2') return 2;
  if (tag === 'h3') return 3;
  if (tag === 'h4') return 4;
  return undefined;
}

/**
 * Parses an approved blog .docx into the normalized BlogContent shape.
 *
 * Extraction rules:
 *  - Word "Heading 1-4" styles → title / h2Headings / h3Headings / h4Headings.
 *  - A trailing "(H1)".."(H4)" suffix on any line (including a plain
 *    paragraph — the common FAQ-question convention) promotes that line to a
 *    heading of the given level, regardless of its own Word style, and the
 *    suffix is stripped from the stored text.
 *  - Labeled paragraphs ("Meta Title: …", "Canonical: …", etc., in any of
 *    their recognized synonyms/casing/punctuation) → metadata fields. Each
 *    label's captured value stops at end-of-line, or at the start of another
 *    recognized label if two ended up on the same physical line (e.g. joined
 *    by a soft line break) — so one metadata field can never bleed into
 *    another (a value never leaks into Canonical/Slug just because Focus
 *    Keyword happens to follow it).
 *  - Metadata-only lines (SEO Slug, Category, Tags, dividers, empty, …) are
 *    silently discarded and never included in paragraphs[], links[], or
 *    boldPhrases[] — nor is the metadata LABEL text itself ever treated as a
 *    bold phrase, even when the content writer bolded the label for
 *    visibility in the brief.
 *  - A soft line break (Shift+Enter, i.e. `<br>`) inside one Word paragraph
 *    is treated as a real line boundary for the purposes above — so e.g. a
 *    "Question (H4)" line followed by its answer on the next soft-broken
 *    line are extracted as a separate heading and a separate paragraph
 *    instead of being concatenated into one paragraph.
 *  - <a href="…"> tags from body content → links[].
 *  - <strong>/<b> tags from body content and headings → boldPhrases[].
 *
 * @param filePath  Path to the .docx file.
 * @param pageUrl   The live blog URL — used to resolve any relative hrefs that
 *                  may appear in the document (Word usually stores absolute
 *                  URLs, so this is a safety net).
 */
export async function parseBlogDocx(filePath: string, pageUrl = ''): Promise<BlogContent> {
  const { value: html } = await mammoth.convertToHtml({ path: filePath });
  const blocks = extractBlocks(html);

  const fields: LabeledFields = {};
  const paragraphs: string[] = [];
  const links: BlogLink[] = [];
  const boldPhrases: string[] = [];
  const headings: HeadingState = { h2Headings: [], h3Headings: [], h4Headings: [] };

  const pushLinksAndBold = (html2: string) => {
    links.push(...extractLinksFromHtml(html2, pageUrl).map((l) => ({ ...l, text: stripHeadingSuffix(l.text) })));
    boldPhrases.push(
      ...extractBoldFromHtml(html2)
        .map((phrase) => stripHeadingSuffix(phrase))
        .filter((phrase) => phrase !== '' && !isMetadataLabelPhrase(phrase))
    );
  };

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    const block = blocks[blockIndex]!;
    if (block.tag === 'table') {
      applyTableRows(block.innerHtml, fields);
      continue;
    }

    if (block.tag === 'ul' || block.tag === 'ol') {
      // A real Word bulleted/numbered list — mammoth renders it as a genuine
      // <ul>/<ol>, unlike every other paragraph style (including "Quote"),
      // which it renders as a plain <p> regardless of the Word style
      // applied. Each item is its own piece of body content, on equal
      // footing with a regular paragraph for comparison purposes.
      for (const itemHtml of extractListItems(block.innerHtml)) {
        const text = htmlToText(itemHtml);
        if (!text || isDividerOnly(text)) continue;
        paragraphs.push(text);
        pushLinksAndBold(itemHtml);
      }
      continue;
    }

    const htmlLines = splitHtmlByBr(block.innerHtml);
    const impliedLevel = tagImpliedLevel(block.tag);

    if (impliedLevel !== undefined) {
      // A genuine Word heading style. Headings are essentially always a
      // single logical line; join any soft-broken lines back together, then
      // let a trailing "(H#)" suffix (if present) override the tag's own
      // level — e.g. an H2-styled heading annotated "(H4)" is treated as H4.
      const realLines = htmlLines
        .map((segment) => htmlToText(segment))
        .filter((text) => text !== '' && !isAnyLabeledField(text) && !isDividerOnly(text));
      if (realLines.length === 0) continue;

      const joined = realLines.join(' ');
      const suffixLevel = detectHeadingSuffixLevel(joined);
      const cleanText = stripHeadingSuffix(joined);
      if (!cleanText) continue;

      const resolvedLevel = suffixLevel ?? impliedLevel;
      if (blockIndex === 0 && resolvedLevel !== 1) {
        headings.firstBlockHeading = { level: resolvedLevel, text: cleanText };
      }

      pushHeading(headings, resolvedLevel, cleanText);
      pushLinksAndBold(block.innerHtml);
      continue;
    }

    // A plain paragraph ('p') block. Walk its lines (soft line breaks count
    // as line boundaries) so a metadata label or a "(H#)"-suffixed FAQ
    // question that got merged into the same Word paragraph as other
    // content is correctly separated out, instead of being concatenated
    // into one paragraph.
    let pendingLines: string[] = [];
    let pendingHtmlSegments: string[] = [];

    const flushPendingParagraph = () => {
      if (pendingLines.length === 0) return;
      const joinedText = pendingLines.join(' ');
      const segments = pendingHtmlSegments;
      pendingLines = [];
      pendingHtmlSegments = [];
      if (!joinedText) return;
      paragraphs.push(joinedText);
      for (const segment of segments) pushLinksAndBold(segment);
    };

    for (let i = 0; i < htmlLines.length; i++) {
      const htmlSegment = htmlLines[i]!;
      const lineText = htmlToText(htmlSegment);
      if (!lineText) continue;

      if (isAnyLabeledField(lineText)) {
        if (isMetadataLabelPhrase(lineText)) {
          // A content writer sometimes types the label alone ("Meta
          // Description:"), presses Shift+Enter, and puts the actual value
          // on the NEXT soft-broken line — rather than "Meta Description:
          // <value>" on one line. When the label line carries no value of
          // its own, treat the following line as this label's value instead
          // of letting it fall through untagged, where it would otherwise
          // leak into paragraphs[] as a bogus body paragraph (and leave the
          // field itself permanently stuck at an empty string, since a
          // label with no value still "claims" the field).
          if (i + 1 < htmlLines.length) {
            const nextText = htmlToText(htmlLines[i + 1]!);
            if (nextText && !isAnyLabeledField(nextText) && !isDividerOnly(nextText)) {
              applyLabelWithSeparateValue(lineText, nextText, fields);
              i++; // the value line is consumed as this label's value, not a separate line
              continue;
            }
          } else if (blockIndex + 1 < blocks.length) {
            // The bare label is the LAST line of this block, with nothing
            // left to check within it — the value may be the ENTIRE next
            // block instead. Real-world docs sometimes run a label onto the
            // tail of an unrelated paragraph (e.g. a stray "Slug:" appended
            // after the Meta Description text) with the value itself
            // starting a whole new Word paragraph, i.e. a hard paragraph
            // break rather than a soft line break — the same leak, just one
            // level up.
            const nextBlock = blocks[blockIndex + 1]!;
            if (nextBlock.tag === 'p') {
              const nextBlockText = splitHtmlByBr(nextBlock.innerHtml).map(htmlToText).filter(Boolean).join(' ');
              if (nextBlockText && !isAnyLabeledField(nextBlockText) && !isDividerOnly(nextBlockText)) {
                applyLabelWithSeparateValue(lineText, nextBlockText, fields);
                blockIndex++; // the whole next block is consumed as this label's value
                continue;
              }
            }
          }
        }
        applyLabeledLine(lineText, fields);
        continue;
      }
      if (isDividerOnly(lineText)) continue;

      const suffixLevel = detectHeadingSuffixLevel(lineText);
      const cleanLine = stripHeadingSuffix(lineText);
      if (!cleanLine) continue;

      if (suffixLevel !== undefined) {
        flushPendingParagraph();
        pushHeading(headings, suffixLevel, cleanLine);
        pushLinksAndBold(htmlSegment);
      } else {
        pendingLines.push(cleanLine);
        pendingHtmlSegments.push(htmlSegment);
      }
    }
    flushPendingParagraph();
  }

  // A labeled "H1: …" / "Title: …" field (inline or from a content-brief
  // table) takes priority over a real Word H1 heading's text when both are
  // present, matching the label-authoring convention's intent — it's only a
  // fallback title source when the document has no real H1 heading at all.
  let title = fields.h1 || headings.title || undefined;

  // Next fallback: the document's actual title was styled Heading 2/3/4
  // instead of Heading 1 (a real recurring pattern — confirmed against
  // real content-brief docs with no "Title:"/"H1:" label at all, just the
  // title text itself sitting in an <h3> as literally the first thing in
  // the document). Requiring both the block-0 position AND real paragraph
  // content elsewhere is deliberate: a heading-only fixture with nothing
  // else in the document (no paragraphs at all) is a normal section
  // heading with no title to infer, not a mis-styled title — only claim it
  // when there's an actual body of content it could plausibly be titling.
  // Removed from its own array so it isn't ALSO independently checked as
  // e.g. "H3 #1" — on the live page it renders as the real page title, not
  // as a numbered sub-heading, so that check would always false-fail.
  if (!title && headings.firstBlockHeading && paragraphs.length > 0) {
    const { level, text } = headings.firstBlockHeading;
    title = text;
    const siblings = level === 2 ? headings.h2Headings : level === 3 ? headings.h3Headings : headings.h4Headings;
    const index = siblings.indexOf(text);
    if (index !== -1) siblings.splice(index, 1);
  }

  // Last-resort fallback: some content briefs just type the blog title as
  // the very first line, with no "Title:"/"H1:" label and no real Word
  // heading style at all — trusting a reader to infer it's the title from
  // its position alone. Only used when nothing else already established a
  // title. The line is claimed as the title (not left in paragraphs[]),
  // since it renders as a heading on the live page, not a body paragraph —
  // left in place, it would always show up as a false "missing paragraph".
  if (!title && paragraphs.length > 0) {
    title = paragraphs.shift();
  }

  return {
    title,
    h2Headings: headings.h2Headings,
    h3Headings: headings.h3Headings,
    h4Headings: headings.h4Headings,
    paragraphs,
    metaTitle:            fields.metaTitle       || undefined,
    metaDescription:      fields.metaDescription || undefined,
    links,
    boldPhrases,
    expectedCanonicalUrl: fields.canonical || undefined,
    expectedSlug:         fields.slug      || undefined
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Splits a block's inner HTML on `<br>` boundaries, preserving the HTML (tags intact) on either side — used so link/bold extraction still sees real markup within each resulting "line". */
function splitHtmlByBr(innerHtml: string): string[] {
  return innerHtml.split(/<br\s*\/?>/gi);
}

/** Applies a bare label line (e.g. "Slug:") together with a value that was found separately (a following soft-broken line, or an entire following block) — reattaches a separator if the label line didn't already end with one, then delegates to applyLabeledLine as if they'd always been written on one line. */
function applyLabelWithSeparateValue(labelLine: string, value: string, fields: LabeledFields): void {
  const labelWithSeparator = /[:\-–—]\s*$/.test(labelLine) ? labelLine : `${labelLine}:`;
  applyLabeledLine(`${labelWithSeparator} ${value}`, fields);
}

function applyLabeledLine(line: string, fields: LabeledFields): void {
  for (const { key, regex } of LABEL_LINE_REGEXES) {
    const match = regex.exec(line);
    if (!match) continue;

    let rest = line.slice(match[0].length);
    // Stop the captured value at the start of another recognized label, in
    // case two labels ended up on the same physical line (e.g. no line
    // break at all between "Canonical: …" and "Focus Keyword: …").
    const nextLabel = NEXT_LABEL_START.exec(rest);
    if (nextLabel) rest = rest.slice(0, nextLabel.index);

    fields[key] = fields[key] ?? normalizeText(rest);
    return;
  }
}

function fieldKeyForLabel(label: string): keyof LabeledFields | undefined {
  const normalized = label.trim();
  return LABEL_FULL_REGEXES.find(({ regex }) => regex.test(normalized))?.key;
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

    const key = fieldKeyForLabel(label);
    if (key) fields[key] = fields[key] ?? value;
  }
}

function extractBlocks(html: string): Block[] {
  const blocks: Block[] = [];
  for (const match of html.matchAll(/<(h1|h2|h3|h4|p|table|ul|ol)[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const tagName   = match[1];
    const innerHtml = match[2];
    if (tagName === undefined || innerHtml === undefined) continue;
    blocks.push({ tag: tagName.toLowerCase() as Block['tag'], innerHtml });
  }
  return blocks;
}

/** Extracts each top-level `<li>…</li>` item's inner HTML from a `<ul>`/`<ol>` block's inner HTML. */
function extractListItems(innerHtml: string): string[] {
  const items: string[] = [];
  for (const match of innerHtml.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    items.push(match[1] ?? '');
  }
  return items;
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
 * `<a>`, …) is stripped, HTML entities are decoded, whitespace is
 * normalized, and invisible/zero-width characters (see INVISIBLE_CHARS)
 * are removed. Exported for direct unit testing of entity/tag handling.
 *
 * Formatting tags are zero-width wrappers around text that already contains
 * whatever real spaces the source document had, so they're stripped to
 * nothing rather than a space — otherwise a bold/italic/link run that starts
 * or ends mid-word (e.g. "Infra" bolded right up against an apostrophe:
 * "Infra's") would gain a phantom space at the tag boundary ("Infra 's").
 * `<br>` is the one exception: it is a genuine line-break/word-separator, so
 * it's turned into a space rather than dropped.
 *
 * Stripping invisible characters here (not just in isDividerOnly) matters
 * because they otherwise survive into the plain text mammoth hands back
 * from real content-brief docs — confirmed directly against a real file
 * where a stray zero-width space (U+200B) sat right before a "Meta Title:"
 * label. Every downstream label-matching regex is anchored with `^\s*`,
 * which does NOT match U+200B, so the label went unrecognized entirely:
 * it fell through as a bogus body paragraph (later mis-claimed as the blog
 * title by the last-resort fallback below) instead of populating
 * metaTitle. Stripping it at the source fixes every consumer at once —
 * label matching, divider detection, and stored paragraph/heading text
 * alike — rather than special-casing each one individually.
 */
export function htmlToText(html: string): string {
  return normalizeText(decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
  )).replace(INVISIBLE_CHARS, '');
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
