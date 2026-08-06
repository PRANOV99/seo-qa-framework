# Changelog

All notable changes to this project are recorded here, newest first.
Versions follow [SemVer](https://semver.org/) (`MAJOR.MINOR.PATCH`) and are
kept in lockstep across `seo-qa-framework/package.json` and
`seo-qa-web/package.json`: MAJOR = breaking change, MINOR = new feature,
PATCH = bug fix.

## [0.4.1] - 2026-08-06

### Fixed
- **History tab loading slowly.** `GET /api/history` was running `SELECT *`,
  fetching every stored audit's full `report` (every check result) and
  `expected_content` (entire parsed docx) columns just to discard both in
  the response — only `summary` and a boolean are ever shown on the list.
  Measured against the real database (92 records): ~870ms/~5.3MB before,
  ~115ms/~98KB after. Added a lightweight `listAuditRecordSummaries()`
  query; the JSON response shape is unchanged.
- **Settings page showing internal API/deployment details.** Removed the
  API Endpoints table, Deployment Guide (Vercel/Render commands), and
  Environment Variables table — developer/ops internals with no reason to
  be visible to a tester. Kept only the Backend API Status card.

## [0.4.0] - 2026-08-05

### Added
- **Blog Testing: detect duplicate `<h1>` tags.** The existing "Blog Title
  (H1)" check only ever compared the *first* `<h1>`'s text, so a CMS
  re-rendering the same title as a second literal `<h1>` inside the article
  body (found on 5 real srisuprajainfracon.com blogs) passed silently. New
  independent "H1 Tag Count" check fails when more than one `<h1>` is
  present on the live page.

## [0.3.0] - 2026-08-03

- Added a FAQ accordion content check to the Website SEO Audit ("sheet")
  workflow.
- Fixed docx title/metadata extraction and relaxed H2/H3/H4 heading
  matching in Blog Testing.

## [0.2.0] - 2026-07-31

- Migrated audit history storage from JSON files on disk to PostgreSQL
  (Neon).
- Fixed three recommendation-sheet parsing bugs found via real client
  (JRC) audit files: undetected URL column, false field-column matches on
  measurement/baseline headers, and misattributed blank-cell fallback URLs.
- Raised the blog batch size limit to 8 and made batch runs concurrent
  (shared browser, bounded concurrency) instead of strictly sequential.
- Simplified the Dev Bug Report export to a minimal Expected/Actual format.
- Hyperlinks are no longer required to also render bold when their anchor
  text happens to match an expected bold phrase.
- Blog docx parsing now supports dash-form heading-level suffixes ("- H1")
  in addition to the parenthesized convention ("(H1)").
- Simplified History page selection to one checkbox per row (drives both
  Compare and Re-run); Upload now accepts multiple `.docx` files at once.
- Fixed docx label/value metadata parsing across paragraph/line breaks, and
  a label-substring truncation bug inside hyphenated slugs.
- Added "Re-run" for a previously-tested blog against a fresh crawl,
  without re-uploading its approved document.
- Added the original Dev Bug Report export for Blog Testing.
- Sped up Blog Testing batches; hyperlink/bold/paragraph comparisons became
  stricter and diff-aware (word-level diffs, occurrence-counted matching).

## [0.1.0] and earlier

Initial framework: the Website SEO Audit ("sheet") workflow, the first cut
of Blog Testing, and Render/Docker deployment setup. Not itemized — this
changelog starts tracking from 0.2.0 onward.
