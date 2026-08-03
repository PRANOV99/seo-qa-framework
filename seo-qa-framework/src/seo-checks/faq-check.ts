import type { Page } from '@playwright/test';
import type { FaqAuditGroup } from '../types/audit.js';
import type { SeoCheckResult } from '../types/check-result.js';
import { normalizeForComparison, normalizeText } from './check-utils.js';
import { computeWordDiff, normalizeQuotes, stripEdgePunctuation } from '../blog/text-diff.js';

interface ExtractedFaq {
  question: string;
  answer: string;
}

const TRUNCATE_LENGTH = 90;

/**
 * Live-page FAQ accordion check. Runs once per page (like BrokenLinkChecker/
 * AccessibilityChecker), not per audit row, since it needs to compare a
 * whole expected set of Q&A pairs against a whole actual set to catch
 * missing/extra items, not just one value at a time.
 *
 * Extraction tries, in order: FAQPage JSON-LD (authoritative when present),
 * then a handful of common accordion DOM patterns (Webflow-style, Elementor,
 * ARIA, native <details>) reading textContent — never innerText — so
 * visually collapsed accordion panels still count, matching the same
 * reasoning already used for blog content in blog-validator.ts. If none of
 * those find anything structural, falls back to a whole-page text presence
 * check (no "extra FAQ" detection possible in that mode, since there's no
 * known item boundary to compare against).
 */
export class FaqChecker {
  async check(page: Page, group: FaqAuditGroup): Promise<SeoCheckResult[]> {
    const structural = await extractStructuralFaqs(page);

    if (structural) {
      return compareStructural(group, structural);
    }

    const pageText = await extractFullPageText(page);
    return compareAgainstFullPageText(group, pageText);
  }
}

/**
 * Renders a question for embedding inside a `"..."`-quoted checkType. Some
 * real questions contain their own literal double quotes (e.g. a question
 * about "Driven by Design") — left as-is, those collide with the
 * surrounding quotes and read as broken/nested in a report. Swapping inner
 * double quotes for single ones avoids that, and truncating at the last
 * whitespace before the limit (not mid-word) keeps a long question
 * legible instead of cutting off inside a word.
 */
function questionPreview(text: string): string {
  const normalized = normalizeText(text).replace(/"/g, "'");
  if (normalized.length <= TRUNCATE_LENGTH) return normalized;

  const truncated = normalized.slice(0, TRUNCATE_LENGTH);
  const lastSpace = truncated.lastIndexOf(' ');
  return `${lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated}…`;
}

function normalizeForFaqComparison(value: string): string {
  return normalizeForComparison(stripEdgePunctuation(normalizeQuotes(value)));
}

function questionsMatch(expected: string, actual: string): boolean {
  const normalizedExpected = normalizeForFaqComparison(expected);
  const normalizedActual = normalizeForFaqComparison(actual);
  return normalizedExpected === normalizedActual;
}

function answerContains(haystack: string, needle: string): boolean {
  const normalizedHaystack = normalizeForFaqComparison(haystack);
  const normalizedNeedle = normalizeForFaqComparison(needle);
  return normalizedNeedle !== '' && normalizedHaystack.includes(normalizedNeedle);
}

function compareStructural(group: FaqAuditGroup, actualFaqs: ExtractedFaq[]): SeoCheckResult[] {
  const results: SeoCheckResult[] = [];
  const matchedActualIndexes = new Set<number>();

  for (const expected of group.faqs) {
    const matchIndex = actualFaqs.findIndex(
      (actual, index) => !matchedActualIndexes.has(index) && questionsMatch(expected.question, actual.question)
    );

    if (matchIndex === -1) {
      results.push({
        url: group.url,
        checkType: `FAQ: "${questionPreview(expected.question)}"`,
        status: 'failed',
        expected: expected.answer,
        actual: 'Missing — add this FAQ (question + answer) to the live page.',
        message: 'This FAQ question was not found on the live page.'
      });
      continue;
    }

    matchedActualIndexes.add(matchIndex);
    const actual = actualFaqs[matchIndex]!;

    // The live site's answer is allowed to contain extra text (e.g. a
    // trailing CTA/link) beyond the sheet's expected answer — a substring
    // containment check, not strict equality, avoids false mismatches for
    // that (confirmed directly against a real jrcprojects.com page, which
    // appends a "Read about our blog →" link after the core answer).
    if (answerContains(actual.answer, expected.answer)) {
      results.push({
        url: group.url,
        checkType: `FAQ: "${questionPreview(expected.question)}"`,
        status: 'passed',
        expected: expected.answer,
        actual: actual.answer
      });
      continue;
    }

    results.push({
      url: group.url,
      checkType: `FAQ: "${questionPreview(expected.question)}"`,
      status: 'failed',
      expected: expected.answer,
      actual: actual.answer,
      message: 'The live answer does not match the expected answer.',
      diff: computeWordDiff(expected.answer, actual.answer)
    });
  }

  actualFaqs.forEach((actual, index) => {
    if (matchedActualIndexes.has(index)) {
      return;
    }

    results.push({
      url: group.url,
      checkType: `FAQ (extra): "${questionPreview(actual.question)}"`,
      status: 'warning',
      expected: 'Not in the approved FAQ sheet — remove this from the live page, or add it to the sheet if it should stay.',
      actual: actual.answer,
      message: 'This FAQ appears on the live page but is not listed in the FAQ sheet.'
    });
  });

  return results;
}

function compareAgainstFullPageText(group: FaqAuditGroup, pageText: string): SeoCheckResult[] {
  return group.faqs.map((expected) => {
    const checkType = `FAQ: "${questionPreview(expected.question)}"`;

    if (!answerContains(pageText, expected.question)) {
      return {
        url: group.url,
        checkType,
        status: 'failed',
        expected: expected.answer,
        actual: 'Missing — add this FAQ (question + answer) to the live page.',
        message: 'This FAQ question was not found on the live page.'
      };
    }

    if (!answerContains(pageText, expected.answer)) {
      return {
        url: group.url,
        checkType,
        status: 'failed',
        expected: expected.answer,
        actual: 'Question is present, but this answer text is missing or different — update the live answer to match Expected.',
        message: 'The FAQ question is present, but its expected answer text could not be found on the live page.'
      };
    }

    return {
      url: group.url,
      checkType,
      status: 'passed',
      expected: expected.answer,
      actual: expected.answer
    };
  });
}

async function extractStructuralFaqs(page: Page): Promise<ExtractedFaq[] | undefined> {
  const found: ExtractedFaq[] = await page.evaluate(() => {
    // Every strategy below is a bare, unnamed arrow function stored as an
    // array element, with NO shared named helper (not even a `const` for
    // trimming text) — Playwright's page.evaluate() serializes this whole
    // outer function's SOURCE TEXT and re-executes it standalone inside the
    // browser. esbuild's keepNames (enabled by tsx's Node build) wraps any
    // NAMED function or `const name = () => ...` with a `__name(...)` helper
    // call to preserve `.name`, but that helper only exists in the Node
    // module scope — embedded in serialized source and run in an isolated
    // browser context, it throws "__name is not defined". This was
    // confirmed for real against the live site with both a named
    // `function foo() {}` declaration AND a `const cleanText = (el) => ...`
    // — only fully anonymous, unbound function values (array elements /
    // call arguments) are safe, matching the existing $$eval callbacks
    // elsewhere in this codebase, which are all plain inline arrow
    // expressions with no named inner helpers, for the same reason. So
    // every text-cleaning read below repeats the same one-line expression
    // inline instead of calling a shared helper.

    const strategies: Array<() => { question: string; answer: string }[]> = [
      // FAQPage JSON-LD — authoritative when present, no DOM guessing needed.
      () => {
        const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
        const results: { question: string; answer: string }[] = [];

        for (const script of scripts) {
          let data: unknown;
          try {
            data = JSON.parse(script.textContent ?? '');
          } catch {
            continue;
          }

          const nodes = Array.isArray(data) ? data : [data];
          for (const node of nodes) {
            const record = node as Record<string, unknown> | null;
            const graph = Array.isArray(record?.['@graph']) ? (record!['@graph'] as unknown[]) : [record];

            for (const entry of graph) {
              const entryRecord = entry as Record<string, unknown> | null;
              const type = entryRecord?.['@type'];
              const isFaqPage = type === 'FAQPage' || (Array.isArray(type) && type.includes('FAQPage'));
              const mainEntity = entryRecord?.['mainEntity'];
              if (!isFaqPage || !Array.isArray(mainEntity)) continue;

              for (const q of mainEntity) {
                const qRecord = q as Record<string, unknown> | null;
                const question = typeof qRecord?.['name'] === 'string' ? (qRecord['name'] as string).trim() : '';
                const acceptedAnswer = qRecord?.['acceptedAnswer'] as Record<string, unknown> | null;
                const answer =
                  typeof acceptedAnswer?.['text'] === 'string' ? (acceptedAnswer['text'] as string).trim() : '';
                if (question && answer) results.push({ question, answer });
              }
            }
          }
        }

        return results;
      },

      // Generic class-based accordion (e.g. Webflow — confirmed against jrcprojects.com).
      () => {
        const results: { question: string; answer: string }[] = [];
        const headingSelector =
          '[class*="accordion"] [class*="trigger"], [class*="accordion"] [class*="heading"], ' +
          '[class*="accordion"] [class*="header"], [class*="accordion"] [class*="title"]';
        const contentSelector = '[class*="content"], [class*="answer"], [class*="body"], [class*="panel"]';
        // headingSelector's four alternatives can all match the same logical
        // question at different nesting levels (e.g. a wrapper div matches
        // via "trigger" while its inner heading tag also matches via
        // "heading") — keep only the leaf-most matches so one question
        // isn't extracted twice.
        const headingCandidates = Array.from(document.querySelectorAll(headingSelector));
        const headings = headingCandidates.filter(
          (el) => !headingCandidates.some((other) => other !== el && el.contains(other))
        );

        for (const heading of headings) {
          // Deliberately NOT heading.closest('[class*="accordion-item"]') —
          // on real markup the trigger's own wrapper class (e.g.
          // "accordion-item-trigger") also substring-matches
          // "accordion-item", so closest() would stop one level too early
          // and never reach the sibling that actually holds the answer.
          // Instead, walk up ancestor by ancestor until one of them
          // contains a content-like element that isn't the heading's own
          // trigger wrapper.
          let contentEl: Element | null = null;
          let ancestor: Element | null = heading.parentElement;
          let depth = 0;

          while (ancestor && depth < 5 && !contentEl) {
            contentEl =
              Array.from(ancestor.querySelectorAll(contentSelector)).find(
                (el) => !el.contains(heading) && (el.textContent ?? '').replace(/\s+/g, ' ').trim() !== ''
              ) ?? null;
            ancestor = ancestor.parentElement;
            depth++;
          }

          const question = (heading.textContent ?? '').replace(/\s+/g, ' ').trim();
          const answer = contentEl ? (contentEl.textContent ?? '').replace(/\s+/g, ' ').trim() : '';
          if (question && answer) results.push({ question, answer });
        }

        return results;
      },

      // Elementor accordion widget.
      () => {
        const results: { question: string; answer: string }[] = [];
        const titles = Array.from(document.querySelectorAll('.elementor-tab-title'));

        for (const title of titles) {
          const container = title.closest('.elementor-accordion-item') ?? title.parentElement;
          const content = container ? container.querySelector('.elementor-tab-content') : null;
          const question = (title.textContent ?? '').replace(/\s+/g, ' ').trim();
          const answer = content ? (content.textContent ?? '').replace(/\s+/g, ' ').trim() : '';
          if (question && answer) results.push({ question, answer });
        }

        return results;
      },

      // ARIA accordion pattern (aria-expanded trigger + aria-controls panel).
      () => {
        const results: { question: string; answer: string }[] = [];
        const triggers = Array.from(document.querySelectorAll('[aria-expanded][aria-controls]'));

        for (const trigger of triggers) {
          const controlsId = trigger.getAttribute('aria-controls');
          const panel = controlsId ? document.getElementById(controlsId) : null;
          const question = (trigger.textContent ?? '').replace(/\s+/g, ' ').trim();
          const answer = panel ? (panel.textContent ?? '').replace(/\s+/g, ' ').trim() : '';
          if (question && answer) results.push({ question, answer });
        }

        return results;
      },

      // Native <details>/<summary>.
      () => {
        const results: { question: string; answer: string }[] = [];
        const detailsEls = Array.from(document.querySelectorAll('details'));

        for (const el of detailsEls) {
          const summary = el.querySelector('summary');
          if (!summary) continue;

          const question = (summary.textContent ?? '').replace(/\s+/g, ' ').trim();
          const clone = el.cloneNode(true) as HTMLElement;
          const cloneSummary = clone.querySelector('summary');
          cloneSummary?.remove();
          const answer = (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
          if (question && answer) results.push({ question, answer });
        }

        return results;
      }
    ];

    for (const strategy of strategies) {
      const result = strategy();
      if (result.length > 0) return result;
    }

    return [];
  });

  return found.length > 0 ? found : undefined;
}

async function extractFullPageText(page: Page): Promise<string> {
  return page.evaluate(() => (document.body?.textContent ?? '').replace(/\s+/g, ' ').trim());
}
