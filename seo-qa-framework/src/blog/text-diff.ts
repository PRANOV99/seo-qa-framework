import type { DiffSegment } from '../types/check-result.js';

export type { DiffSegment };

/**
 * Normalizes "smart"/curly quotes and apostrophes to their plain ASCII
 * equivalents. Content platforms (e.g. WordPress' wptexturize) routinely
 * substitute straight quotes for curly ones on publish — that is a
 * typographic rendering choice, not a content change, so it should never by
 * itself cause a paragraph comparison to fail.
 */
export function normalizeQuotes(value: string): string {
  return value
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"');
}

/**
 * Strips a run of sentence-ending punctuation (. , ! ? ; : and the "…"
 * ellipsis character) from the very start and end of a string only —
 * punctuation in the MIDDLE of the text is left untouched. A CMS/editor
 * adding or dropping a trailing period (or similar) on publish is a
 * formatting nicety, not a content change, so it should never by itself
 * fail a metadata/heading/paragraph comparison — only a genuine wording
 * change should.
 */
export function stripEdgePunctuation(value: string): string {
  return value.replace(/^[.,!?;:…]+|[.,!?;:…]+$/g, '');
}

function tokenize(text: string): string[] {
  return text.split(/\s+/).filter((token) => token !== '');
}

/**
 * Computes the longest common subsequence (LCS) between two sequences under
 * a custom equality function, returning — for each index in `a` — the
 * corresponding index in `b` if that element participates in the maximal
 * order-preserving alignment, or `undefined` if it doesn't.
 *
 * This is the general building block behind "resynchronizing" sequence
 * comparisons: elements in the LCS are genuinely in the same relative order
 * in both sequences, so one inserted/removed/reordered element elsewhere
 * doesn't cascade into false mismatches for everything that follows it.
 * Used by the blog comparator's paragraph-order resynchronization.
 */
export function computeLcsAlignment<T>(
  a: readonly T[],
  b: readonly T[],
  equals: (x: T, y: T) => boolean
): Array<number | undefined> {
  const n = a.length;
  const m = b.length;

  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] = equals(a[i]!, b[j]!)
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const alignment: Array<number | undefined> = new Array(n).fill(undefined);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (equals(a[i]!, b[j]!)) {
      alignment[i] = j;
      i++; j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
  return alignment;
}

/**
 * Computes a word-level diff between two texts using an LCS (longest common
 * subsequence) alignment. Token equality is case-insensitive, matching the
 * existing case-insensitive paragraph-comparison semantics elsewhere in the
 * blog comparator — a case-only difference is not itself reported as a
 * change. Adjacent removed+added runs of equal length are paired up as
 * 'changed' so a substitution reads as "word A → word B" rather than as a
 * separate removal and addition.
 */
export function computeWordDiff(expectedText: string, actualText: string): DiffSegment[] {
  const expectedTokens = tokenize(expectedText);
  const actualTokens = tokenize(actualText);
  const expectedKeys = expectedTokens.map((t) => t.toLowerCase());
  const actualKeys = actualTokens.map((t) => t.toLowerCase());

  const n = expectedTokens.length;
  const m = actualTokens.length;

  // lcs[i][j] = length of the longest common subsequence of
  // expectedKeys[i..] and actualKeys[j..].
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = expectedKeys[i] === actualKeys[j]
        ? lcs[i + 1]![j + 1]! + 1
        : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  interface RawOp { type: 'same' | 'removed' | 'added'; text: string }
  const ops: RawOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (expectedKeys[i] === actualKeys[j]) {
      ops.push({ type: 'same', text: expectedTokens[i]! });
      i++; j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      ops.push({ type: 'removed', text: expectedTokens[i]! });
      i++;
    } else {
      ops.push({ type: 'added', text: actualTokens[j]! });
      j++;
    }
  }
  while (i < n) { ops.push({ type: 'removed', text: expectedTokens[i]! }); i++; }
  while (j < m) { ops.push({ type: 'added', text: actualTokens[j]! }); j++; }

  // Merge into displayable segments, pairing adjacent removed/added runs as 'changed'.
  const segments: DiffSegment[] = [];
  let k = 0;
  while (k < ops.length) {
    const op = ops[k]!;
    if (op.type === 'same') {
      segments.push({ type: 'same', expected: op.text, actual: op.text });
      k++;
      continue;
    }

    const removed: string[] = [];
    const added: string[] = [];
    while (k < ops.length && ops[k]!.type !== 'same') {
      const next = ops[k]!;
      if (next.type === 'removed') removed.push(next.text);
      else added.push(next.text);
      k++;
    }

    const pairCount = Math.min(removed.length, added.length);
    for (let p = 0; p < pairCount; p++) {
      segments.push({ type: 'changed', expected: removed[p], actual: added[p] });
    }
    for (let p = pairCount; p < removed.length; p++) {
      segments.push({ type: 'removed', expected: removed[p] });
    }
    for (let p = pairCount; p < added.length; p++) {
      segments.push({ type: 'added', actual: added[p] });
    }
  }

  return segments;
}

/** Produces a concise, specific summary of a word diff for use in a check's `message` field. */
export function summarizeWordDiff(diff: DiffSegment[]): string {
  const changed = diff.filter((d) => d.type === 'changed');
  const removed = diff.filter((d) => d.type === 'removed');
  const added = diff.filter((d) => d.type === 'added');

  const parts: string[] = [];
  if (changed.length > 0) parts.push(`${changed.length} word${changed.length === 1 ? '' : 's'} changed`);
  if (removed.length > 0) parts.push(`${removed.length} word${removed.length === 1 ? '' : 's'} missing`);
  if (added.length > 0) parts.push(`${added.length} word${added.length === 1 ? '' : 's'} added`);

  if (parts.length === 0) return 'Paragraph text has changed.';

  const example = changed[0]
    ? ` (e.g. "${changed[0].expected}" → "${changed[0].actual}")`
    : removed[0]
      ? ` (e.g. missing "${removed[0].expected}")`
      : added[0]
        ? ` (e.g. extra "${added[0].actual}")`
        : '';

  return `Paragraph text has changed — ${parts.join(', ')}${example}.`;
}
