import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, urlsAreEquivalent } from '../../src/blog/url-normalizer.js';

const BASE = 'https://example.com/blog/sourdough';

describe('normalizeUrl', () => {
  it('leaves already-clean absolute URLs unchanged', () => {
    const url = 'https://example.com/guides/starter';
    assert.equal(normalizeUrl(url, BASE), url);
  });

  it('resolves relative paths against the base URL', () => {
    assert.equal(
      normalizeUrl('/tools/dutch-oven', BASE),
      'https://example.com/tools/dutch-oven'
    );
  });

  it('strips utm_* tracking parameters', () => {
    assert.equal(
      normalizeUrl('https://example.com/page?utm_source=blog&utm_medium=link&utm_campaign=spring', BASE),
      'https://example.com/page'
    );
  });

  it('strips fbclid and gclid tracking parameters', () => {
    assert.equal(
      normalizeUrl('https://example.com/page?fbclid=abc123&gclid=xyz', BASE),
      'https://example.com/page'
    );
  });

  it('preserves non-tracking query parameters', () => {
    assert.equal(
      normalizeUrl('https://example.com/search?q=sourdough&page=2', BASE),
      'https://example.com/search?page=2&q=sourdough'   // sorted alphabetically
    );
  });

  it('strips trailing slash from non-root pathnames', () => {
    assert.equal(
      normalizeUrl('https://example.com/guides/starter/', BASE),
      'https://example.com/guides/starter'
    );
  });

  it('preserves the root slash', () => {
    assert.equal(normalizeUrl('https://example.com/', BASE), 'https://example.com/');
  });

  it('lowercases the hostname', () => {
    assert.equal(
      normalizeUrl('https://EXAMPLE.COM/page', BASE),
      'https://example.com/page'
    );
  });

  it('strips the URL fragment (#anchor)', () => {
    assert.equal(
      normalizeUrl('https://example.com/page#section-2', BASE),
      'https://example.com/page'
    );
  });

  it('returns mailto: and tel: links unchanged', () => {
    assert.equal(normalizeUrl('mailto:info@example.com', BASE), 'mailto:info@example.com');
    assert.equal(normalizeUrl('tel:+441234567890', BASE), 'tel:+441234567890');
  });

  it('returns # anchor-only links unchanged', () => {
    assert.equal(normalizeUrl('#section', BASE), '#section');
  });
});

describe('urlsAreEquivalent', () => {
  it('treats relative and absolute forms of the same URL as equal', () => {
    assert.ok(urlsAreEquivalent(
      '/guides/starter',
      'https://example.com/guides/starter',
      'https://example.com/blog'
    ));
  });

  it('treats URLs with and without tracking params as equal', () => {
    assert.ok(urlsAreEquivalent(
      'https://example.com/page',
      'https://example.com/page?utm_source=email&fbclid=xyz',
      BASE
    ));
  });

  it('treats URLs with trailing slash and without as equal', () => {
    assert.ok(urlsAreEquivalent(
      'https://example.com/guides/starter/',
      'https://example.com/guides/starter',
      BASE
    ));
  });

  it('returns false for genuinely different URLs', () => {
    assert.ok(!urlsAreEquivalent(
      'https://example.com/page-a',
      'https://example.com/page-b',
      BASE
    ));
  });
});
