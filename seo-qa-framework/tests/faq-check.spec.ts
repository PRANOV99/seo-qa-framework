import type { FaqAuditGroup } from '../src/types/audit.js';
import { FaqChecker } from '../src/seo-checks/faq-check.js';
import { test, expect } from '../src/fixtures/test-fixtures.js';

function group(faqs: FaqAuditGroup['faqs']): FaqAuditGroup {
  return { url: 'https://example.com/page', label: 'Example Page', faqs };
}

test.describe('FaqChecker', () => {
  test.skip(({ browserName }) => browserName === 'firefox', 'Firefox page creation fails in this local runner.');

  test('passes when the accordion question and answer match exactly (Webflow-style markup)', async ({ page }) => {
    await page.setContent(`
      <div class="accordion-item-4">
        <div class="accordion-item-trigger"><h4 class="accordion-heading">What is JRC Wildwoods?</h4></div>
        <div class="accordion-item-content-3"><p>A low-density apartment community.</p></div>
      </div>
    `);

    const results = await new FaqChecker().check(page, group([
      { question: 'What is JRC Wildwoods?', answer: 'A low-density apartment community.', sourceRowNumber: 2 }
    ]));

    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe('passed');
    expect(results[0]!.checkType).toContain('What is JRC Wildwoods?');
  });

  test('tolerates extra trailing text in the live answer (e.g. an appended CTA link)', async ({ page }) => {
    await page.setContent(`
      <div class="accordion-item-4">
        <div class="accordion-item-trigger"><h4 class="accordion-heading">What is ClubWild?</h4></div>
        <div class="accordion-item-content-3"><p>ClubWild is the community clubhouse. <a href="/blog">Read more →</a></p></div>
      </div>
    `);

    const results = await new FaqChecker().check(page, group([
      { question: 'What is ClubWild?', answer: 'ClubWild is the community clubhouse.', sourceRowNumber: 2 }
    ]));

    expect(results[0]!.status).toBe('passed');
  });

  test('fails with a word diff when the live answer genuinely differs', async ({ page }) => {
    await page.setContent(`
      <div class="accordion-item-4">
        <div class="accordion-item-trigger"><h4 class="accordion-heading">Where is JRC Wildwoods located?</h4></div>
        <div class="accordion-item-content-3"><p>It is located in Whitefield.</p></div>
      </div>
    `);

    const results = await new FaqChecker().check(page, group([
      { question: 'Where is JRC Wildwoods located?', answer: 'It is located in Sarjapur.', sourceRowNumber: 2 }
    ]));

    expect(results[0]!.status).toBe('failed');
    expect(results[0]!.diff).toBeTruthy();
    expect(results[0]!.diff!.some((segment) => segment.type === 'changed')).toBe(true);
  });

  test('fails with "not found" when the expected question is entirely missing from the page', async ({ page }) => {
    await page.setContent(`
      <div class="accordion-item-4">
        <div class="accordion-item-trigger"><h4 class="accordion-heading">Unrelated question?</h4></div>
        <div class="accordion-item-content-3"><p>Unrelated answer.</p></div>
      </div>
    `);

    const results = await new FaqChecker().check(page, group([
      { question: 'Missing question?', answer: 'Any answer.', sourceRowNumber: 2 }
    ]));

    expect(results[0]!.status).toBe('failed');
    expect(results[0]!.actual).toBe('Missing — add this FAQ (question + answer) to the live page.');
  });

  test('does not produce a broken nested-quote checkType when the question itself contains literal double quotes', async ({ page }) => {
    await page.setContent(`
      <div class="accordion-item-4">
        <div class="accordion-item-trigger"><h4 class="accordion-heading">What does "Driven by Design" mean?</h4></div>
        <div class="accordion-item-content-3"><p>It is JRC's core philosophy.</p></div>
      </div>
    `);

    const results = await new FaqChecker().check(page, group([
      { question: 'What does "Driven by Design" mean?', answer: "It is JRC's core philosophy.", sourceRowNumber: 2 }
    ]));

    expect(results[0]!.status).toBe('passed');
    // Inner double quotes are swapped for single quotes so the checkType's
    // own wrapping quotes don't collide with quotes inside the question.
    expect(results[0]!.checkType).toBe(`FAQ: "What does 'Driven by Design' mean?"`);
  });

  test('flags an accordion item on the live page that is not in the FAQ sheet as "(extra)"', async ({ page }) => {
    await page.setContent(`
      <div class="accordion-item-4">
        <div class="accordion-item-trigger"><h4 class="accordion-heading">Expected question?</h4></div>
        <div class="accordion-item-content-3"><p>Expected answer.</p></div>
      </div>
      <div class="accordion-item-4">
        <div class="accordion-item-trigger"><h4 class="accordion-heading">Unlisted question?</h4></div>
        <div class="accordion-item-content-3"><p>Unlisted answer.</p></div>
      </div>
    `);

    const results = await new FaqChecker().check(page, group([
      { question: 'Expected question?', answer: 'Expected answer.', sourceRowNumber: 2 }
    ]));

    expect(results).toHaveLength(2);
    const extra = results.find((r) => r.checkType.startsWith('FAQ (extra)'));
    expect(extra).toBeTruthy();
    expect(extra!.status).toBe('warning');
  });

  test('reads FAQPage JSON-LD directly when present, without needing DOM accordion markup', async ({ page }) => {
    await page.setContent(`
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          "mainEntity": [
            {
              "@type": "Question",
              "name": "What is Kanso?",
              "acceptedAnswer": { "@type": "Answer", "text": "A villa community on Sarjapur-Attibele Road." }
            }
          ]
        }
      </script>
    `);

    const results = await new FaqChecker().check(page, group([
      { question: 'What is Kanso?', answer: 'A villa community on Sarjapur-Attibele Road.', sourceRowNumber: 2 }
    ]));

    expect(results[0]!.status).toBe('passed');
  });

  test('falls back to whole-page text presence when no structural accordion pattern is found', async ({ page }) => {
    await page.setContent(`
      <p>Some intro text.</p>
      <p>What is JRC Sanzio? It is a French Art Deco villa community with only 39 villas.</p>
    `);

    const results = await new FaqChecker().check(page, group([
      { question: 'What is JRC Sanzio?', answer: 'a French Art Deco villa community with only 39 villas', sourceRowNumber: 2 },
      { question: 'A question never mentioned anywhere?', answer: 'Anything.', sourceRowNumber: 3 }
    ]));

    expect(results).toHaveLength(2);
    expect(results[0]!.status).toBe('passed');
    expect(results[1]!.status).toBe('failed');
    // Fallback mode has no known item boundaries, so it can't report "extra" items.
    expect(results.some((r) => r.checkType.startsWith('FAQ (extra)'))).toBe(false);
  });
});
