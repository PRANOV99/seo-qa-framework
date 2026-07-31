# SEO QA Automation Framework

Playwright + TypeScript framework for validating SEO fixes from CSV/XLSX audit sheets.

## Current Scope

The framework includes project architecture, Playwright setup, reusable browser helpers, the SEO audit parser (supporting both issue-based audit sheets and "recommendation sheet" value-comparison sheets, auto-detected), reusable SEO check modules, a redirect checker, a broken link checker, an Audit Runner that smartly executes only the checks required by each row's detected issue type (including accessibility and Lighthouse checks only when the sheet calls for them), a standalone Blog Content Validation module that compares a published blog page against an approved `.docx` from the content team, Developer/QA report generation (HTML, CSV, JSON, Markdown), a dashboard, and run-to-run history comparison (Fixed / Still Failing / New Issues).

## Project Structure

```text
seo-qa-framework/
  audit-sheets/            Sample and input SEO audit sheets
  history/                 Persisted run history (Fixed/Still Failing/New Issues)
  logs/                    Runtime logs
  reports/                 Generated SEO QA reports and dashboard.html
  screenshots/             Captured evidence screenshots
  src/
    blog/                  Blog .docx parsing and docx-vs-live content comparison
    cli/                   Command-line entrypoints (audit, blog-audit, compare)
    config/                Environment and framework configuration
    dashboard/             Dashboard HTML generator
    fixtures/              Reusable Playwright fixtures
    history/               History persistence and run comparison
    logger/                Logger setup
    parsers/               CSV/XLSX parser layer
    playwright/            Browser, page, and screenshot helpers
    reports/               Report generation layer (JSON/CSV/Markdown/HTML)
    runner/                Audit runners (sheet-driven and blog-validation)
    seo-checks/            SEO, redirect, broken link, accessibility, Lighthouse, and live blog-content checks
    types/                 Shared TypeScript types
    utils/                 Shared utilities
  tests/                   Playwright specs and unit tests
```

## Setup

```bash
npm install
npx playwright install
cp .env.example .env
```

## Scripts

```bash
npm run build
npm run typecheck
npm run test:unit
npm test
npm run test:headed
npm run test:debug
npm run test:chromium
npm run test:firefox
npm run test:webkit
npm run report
npm run install:browsers
npm run audit
npm run audit -- --sheet=audit-sheets/your-audit.xlsx
npm run blog-audit -- --doc="audit-sheets/Blog.docx" --url="https://example.com/blog/post"
npm run compare
npm run seo:run
```

## Environment

Copy `.env.example` to `.env` and adjust values for the target site and audit sheet path.

| Variable | Purpose |
| --- | --- |
| `BASE_URL` | Target site base URL |
| `AUDIT_SHEET_PATH` | CSV/XLSX audit sheet path |
| `REPORT_OUTPUT_DIR` | SEO report output directory |
| `SCREENSHOT_DIR` | Evidence screenshot directory |
| `HISTORY_DIR` | CLI run-history snapshot directory (unrelated to the web API's audit history below) |
| `DATABASE_URL` | PostgreSQL connection string — required by the **web API** (`api/server.ts`) to persist its audit history (the History page). Not used by the CLI. |
| `LOG_LEVEL` | Logger verbosity |
| `CI` | Enables CI-friendly Playwright behavior |
| `TEST_TIMEOUT_MS` | Playwright test timeout |
| `EXPECT_TIMEOUT_MS` | Playwright assertion timeout |
| `ACTION_TIMEOUT_MS` | Playwright action timeout |
| `NAVIGATION_TIMEOUT_MS` | Page navigation timeout |
| `HEADLESS` | Runs browsers in headless mode |
| `VIEWPORT_WIDTH` | Default viewport width |
| `VIEWPORT_HEIGHT` | Default viewport height |

## Current Status

The framework is feature-complete end-to-end:

- **Phase 4**: Meta Title, Meta Description, Canonical, H1, H2, ALT Text, Open Graph, and Twitter Card checks.
- **Phase 5**: Redirect Checker, Broken Link Checker, and the Audit Runner (`src/runner`), which parses a sheet, visits each affected URL once, and smartly runs only the checks required by the issue types detected on that page — including running an axe-core accessibility scan or a Lighthouse audit only when the sheet flags `accessibility`/`performance` issues.
- **Reports** (`src/reports`): every `npm run audit` writes a JSON export, a CSV export, a Developer Markdown/HTML report (full row-level detail with screenshots), and a QA Markdown/HTML report (category-level summary) to `REPORT_OUTPUT_DIR`.
- **Dashboard** (`src/dashboard`): a single, overwritten `dashboard.html` summarizing PASS/FAIL/WARNING totals, redirect issues, broken links, and SEO issues by category.
- **History** (`src/history`): each run's failing checks are snapshotted per audit sheet under `HISTORY_DIR`. `npm run audit` automatically compares against the previous run; `npm run compare` re-compares the two most recent saved snapshots without re-running the audit. Comparisons report **Fixed**, **Still Failing**, and **New Issues**.

Use `--no-accessibility`, `--no-lighthouse`, `--no-screenshots`, or `--no-history` on `npm run audit` to opt out of any of these for a given run.

- **Blog Content Validation** (`src/blog`, `src/runner/blog-audit-runner.ts`): `npm run blog-audit -- --doc="path/to/Blog.docx" --url="https://example.com/blog/post"` parses the approved blog `.docx` (title/H1, H2s, H3s, body paragraphs in order, and a "Meta Title:"/"Meta Description:" labeled paragraph or 2-column table), opens the live URL with Playwright, extracts the same fields from the published page, and produces a PASS/FAIL comparison for every field — including missing/changed headings, missing/modified/reordered paragraphs, and metadata differences. This is a separate, independent workflow from the sheet-based audit, but reuses the exact same `ReportGenerator`, `DashboardGenerator`, and `HistoryStore` as `npm run audit`, so Developer/QA reports (HTML/CSV/JSON/Markdown), the dashboard, and history comparison all work identically. The QA report additionally shows a blog-specific Total Checks / Passed / Failed / Missing Content / Modified Content / Metadata Issues summary.
