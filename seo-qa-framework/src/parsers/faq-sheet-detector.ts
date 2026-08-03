export interface FaqColumnIndexes {
  urlIndex: number;
  questionIndex: number;
  answerIndex: number;
}

const URL_HEADERS = new Set(['url']);
const QUESTION_HEADERS = new Set(['faqs', 'faq', 'question', 'questions']);
const ANSWER_HEADERS = new Set(['answer', 'answers']);

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Detects an FAQ accordion sheet's URL/FAQs/Answer columns from a header
 * row. Deliberately narrow (exact header-name matches only, no fuzzy/
 * substring matching) so this can never misfire on a normal audit sheet —
 * the existing issueBased/recommendation sheets have no header combination
 * that would satisfy all three of these at once.
 */
export function detectFaqColumns(headers: readonly string[]): FaqColumnIndexes | undefined {
  const normalized = headers.map(normalizeHeader);
  const urlIndex = normalized.findIndex((header) => URL_HEADERS.has(header));
  const questionIndex = normalized.findIndex((header) => QUESTION_HEADERS.has(header));
  const answerIndex = normalized.findIndex((header) => ANSWER_HEADERS.has(header));

  if (urlIndex === -1 || questionIndex === -1 || answerIndex === -1) {
    return undefined;
  }

  return { urlIndex, questionIndex, answerIndex };
}
