/**
 * Query-string parameters that are pure tracking metadata — they identify
 * the marketing campaign that brought a visitor to the page but do not
 * change the destination content.  Links pointing to the same URL with or
 * without these parameters should be treated as identical.
 */
const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'fbclid',
  'gclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'ref',
  'source',
  '_ga',
  'yclid',
  'twclid'
]);

/**
 * Returns a canonical form of `href`, suitable for equality comparison:
 *
 *  - Relative URLs are resolved against `baseUrl` (the live page URL).
 *  - Tracking query-string parameters are removed.
 *  - The pathname is de-duplicated of a trailing slash (except root "/").
 *  - The hostname is lowercased.
 *  - The fragment (#…) is stripped — two links to the same page that
 *    differ only in their in-page anchor should be considered equivalent.
 *
 * Returns `href` unchanged when URL parsing fails (e.g. `mailto:`, `tel:`,
 * JavaScript pseudo-URLs, or other non-HTTP schemes).
 */
export function normalizeUrl(href: string, baseUrl: string): string {
  // Skip non-navigational protocols.
  if (/^(mailto:|tel:|javascript:|#)/.test(href.trim())) {
    return href.trim();
  }

  try {
    const url = new URL(href, baseUrl);

    // Remove tracking parameters.
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }

    // Sort remaining params for stable comparison.
    url.searchParams.sort();

    // Remove trailing slash from pathnames other than the site root.
    if (url.pathname !== '/' && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }

    // Lowercase the hostname (hostnames are case-insensitive in HTTP).
    url.hostname = url.hostname.toLowerCase();

    // Drop fragment — same-page anchor differences are not meaningful for
    // content validation.
    url.hash = '';

    return url.toString();
  } catch {
    // Unresolvable href — return as-is so the caller can still compare it.
    return href.trim();
  }
}

/**
 * Returns true when two hrefs resolve to the same canonical URL.
 * Both are normalised against `baseUrl` before comparison.
 */
export function urlsAreEquivalent(href1: string, href2: string, baseUrl: string): boolean {
  return normalizeUrl(href1, baseUrl) === normalizeUrl(href2, baseUrl);
}
