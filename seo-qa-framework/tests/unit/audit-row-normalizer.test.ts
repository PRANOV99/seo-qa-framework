import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectIssueType } from '../../src/parsers/audit-row-normalizer.js';

describe('SEO issue type detection (Phase 5 additions)', () => {
  it('detects redirect issues ahead of the generic status code pattern', () => {
    assert.equal(detectIssueType('Page returns a 302 redirect'), 'redirect');
    assert.equal(detectIssueType('Redirect chain is too long'), 'redirect');
  });

  it('detects broken link issues', () => {
    assert.equal(detectIssueType('Broken link found on page'), 'brokenLink');
    assert.equal(detectIssueType('Page returns 404'), 'brokenLink');
    assert.equal(detectIssueType('Server error 503 on resource'), 'brokenLink');
  });

  it('still falls back to the generic status code type for other phrasing', () => {
    assert.equal(detectIssueType('Unexpected status code returned'), 'statusCode');
  });

  it('detects accessibility issues', () => {
    assert.equal(detectIssueType('Accessibility violations found (WCAG)'), 'accessibility');
    assert.equal(detectIssueType('Missing screen reader support'), 'accessibility');
  });

  it('detects performance issues', () => {
    assert.equal(detectIssueType('Lighthouse performance score is low'), 'performance');
    assert.equal(detectIssueType('Poor Core Web Vitals (LCP)'), 'performance');
  });
});
