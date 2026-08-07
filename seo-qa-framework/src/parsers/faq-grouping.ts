import type { FaqAuditGroup, UnresolvedFaqGroup } from '../types/audit.js';

/**
 * One physical sheet row's FAQ-relevant content, already unwrapped from
 * whatever spreadsheet-format quirks (merged cells, hyperlink objects,
 * rich text) the source parser deals with — xlsx and csv parsers both
 * reduce down to this shape before calling groupFaqRows.
 */
export interface RawFaqRow {
  /** Text of the URL cell, trimmed. Empty string when blank. */
  urlText: string;
  /** The real target URL, when the URL cell resolves to one (xlsx hyperlink, or a literal absolute URL in csv). */
  urlHyperlink?: string;
  question: string;
  answer: string;
  sourceRowNumber: number;
}

export interface FaqGroupingResult {
  faqGroups: FaqAuditGroup[];
  unresolvedFaqGroups: UnresolvedFaqGroup[];
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isFullyBlank(row: RawFaqRow): boolean {
  return row.urlText === '' && row.question === '' && row.answer === '';
}

function identityKeyOf(row: RawFaqRow): string {
  return row.urlHyperlink ?? `label:${normalizeLabel(row.urlText)}`;
}

/**
 * Splits rows into blocks separated by fully-blank rows (URL, question, AND
 * answer all empty). A block is the outer grouping boundary — confirmed by
 * unzipping the real JRC sheet: nothing else in the sheet reliably marks
 * where one page's FAQ set ends and the next begins.
 */
function splitIntoBlocks(rows: readonly RawFaqRow[]): RawFaqRow[][] {
  const blocks: RawFaqRow[][] = [];
  let current: RawFaqRow[] = [];

  for (const row of rows) {
    if (isFullyBlank(row)) {
      if (current.length > 0) blocks.push(current);
      current = [];
      continue;
    }
    current.push(row);
  }
  if (current.length > 0) blocks.push(current);

  return blocks;
}

/**
 * Groups FAQ sheet rows into one entry per page: split into blank-row-
 * delimited blocks, then walk each block tracking one "current identity"
 * (a real URL if the row has a hyperlink, otherwise an unresolved label),
 * flushing and starting a new identity whenever a row's URL cell is
 * non-blank and names a different one than what's currently open. A row
 * whose URL cell is blank just continues whatever identity is open.
 *
 * Two real patterns from the source sheet drove this shape, and a naive
 * "one hyperlink resolves the whole block" rule breaks one or the other:
 *
 * - "JRC Sanzio": the block is four merge-ranges deep (A20:A23 blank,
 *   A24 alone — the hyperlink, A25:A27 blank), so three of Sanzio's real
 *   questions sit in blank-URL rows ABOVE the hyperlink. Those leading
 *   blank rows have no identity yet when the block starts, so they're
 *   attached RETROACTIVELY to the block's first identity once it's known
 *   (see below) instead of being dropped.
 * - "Whitefield vs. Sarjapur" immediately followed by "NEW FAQs": the same
 *   block that carries the Whitefield hyperlink runs (with zero blank
 *   rows) straight into a differently-labelled, never-hyperlinked section
 *   ("Home page" / "Wildwood" / "Kanso" repeated, no link of their own).
 *   Those rows each restate their OWN non-blank label, so — unlike Sanzio's
 *   blank continuation rows — they correctly start their own new
 *   (unresolved) identity instead of inheriting Whitefield's.
 */
export function groupFaqRows(rows: readonly RawFaqRow[]): FaqGroupingResult {
  const faqGroups: FaqAuditGroup[] = [];
  const unresolvedFaqGroups: UnresolvedFaqGroup[] = [];

  for (const block of splitIntoBlocks(rows)) {
    const { faqGroups: blockResolved, unresolvedFaqGroups: blockUnresolved } = groupBlock(block);
    faqGroups.push(...blockResolved);
    unresolvedFaqGroups.push(...blockUnresolved);
  }

  return { faqGroups: mergeGroupsBySameUrl(faqGroups), unresolvedFaqGroups };
}

/**
 * Merges any two (or more) resolved groups that ended up pointing at the
 * exact same URL into one, concatenating their questions. Confirmed
 * against a real sheet: two DIFFERENT blog-post labels ("Why Living with
 * Fewer Neighbors..." and "Low-Density Living: The New Luxury...") had
 * their hyperlinks both mistakenly set to the same target page. Checking
 * them as two separate groups visits that one live page twice, and each
 * run's OWN unmatched-item detection sees the OTHER group's questions as
 * "extra" — so every real question gets reported twice (once correctly,
 * once as a phantom "(extra)" duplicate). There is only one live page to
 * check either way, so its "extra" content is only meaningful relative to
 * the FULL combined set of everything the sheet expects there.
 */
function mergeGroupsBySameUrl(groups: readonly FaqAuditGroup[]): FaqAuditGroup[] {
  const byUrl = new Map<string, FaqAuditGroup>();
  const order: string[] = [];

  for (const group of groups) {
    const existing = byUrl.get(group.url);
    if (existing) {
      existing.faqs.push(...group.faqs);
      continue;
    }
    byUrl.set(group.url, { ...group, faqs: [...group.faqs] });
    order.push(group.url);
  }

  return order.map((url) => byUrl.get(url)!);
}

function groupBlock(block: readonly RawFaqRow[]): FaqGroupingResult {
  const faqGroups: FaqAuditGroup[] = [];
  const unresolvedFaqGroups: UnresolvedFaqGroup[] = [];

  let currentIdentityKey: string | undefined;
  let currentResolved: FaqAuditGroup | undefined;
  let currentUnresolved: UnresolvedFaqGroup | undefined;

  const flush = (): void => {
    if (currentResolved && currentResolved.faqs.length > 0) faqGroups.push(currentResolved);
    if (currentUnresolved && currentUnresolved.faqCount > 0) unresolvedFaqGroups.push(currentUnresolved);
    currentResolved = undefined;
    currentUnresolved = undefined;
    currentIdentityKey = undefined;
  };

  const open = (labelRow: RawFaqRow): void => {
    if (labelRow.urlHyperlink) {
      currentResolved = { url: labelRow.urlHyperlink, label: labelRow.urlText, faqs: [] };
    } else {
      currentUnresolved = { label: labelRow.urlText, sourceRowNumber: labelRow.sourceRowNumber, faqCount: 0 };
    }
  };

  // Retroactively open the block's FIRST labelled row's identity before
  // processing anything, so leading blank-URL rows (the Sanzio case) attach
  // forward to it instead of having no identity to attach to at all.
  const firstLabelled = block.find((row) => row.urlText !== '');
  if (firstLabelled) {
    currentIdentityKey = identityKeyOf(firstLabelled);
    open(firstLabelled);
  }

  for (const row of block) {
    if (row.urlText !== '') {
      const identityKey = identityKeyOf(row);
      if (identityKey !== currentIdentityKey) {
        flush();
        currentIdentityKey = identityKey;
        open(row);
      }
    }

    if (row.question === '' || row.answer === '') {
      continue;
    }

    if (currentResolved) {
      currentResolved.faqs.push({ question: row.question, answer: row.answer, sourceRowNumber: row.sourceRowNumber });
    } else if (currentUnresolved) {
      currentUnresolved.faqCount += 1;
    }
  }

  flush();

  return { faqGroups, unresolvedFaqGroups };
}
