import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractLighthouseScores } from '../../src/seo-checks/lighthouse-check.js';

describe('extractLighthouseScores', () => {
  it('converts 0-1 category scores into 0-100 percentages', () => {
    const scores = extractLighthouseScores({
      performance: { score: 0.82 },
      accessibility: { score: 0.9 },
      'best-practices': { score: 1 },
      seo: { score: 0.5 }
    });

    assert.deepEqual(scores, { performance: 82, accessibility: 90, bestPractices: 100, seo: 50 });
  });

  it('returns null for categories that are missing or have a null score', () => {
    const scores = extractLighthouseScores({
      performance: { score: null }
    });

    assert.equal(scores.performance, null);
    assert.equal(scores.accessibility, null);
    assert.equal(scores.bestPractices, null);
    assert.equal(scores.seo, null);
  });
});
