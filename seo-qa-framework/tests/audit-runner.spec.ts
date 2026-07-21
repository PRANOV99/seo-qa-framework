import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '../src/fixtures/test-fixtures.js';
import { AuditRunner } from '../src/runner/audit-runner.js';

test.describe('AuditRunner', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'The audit runner launches its own browser internally; one run covers the behaviour.'
  );

  let server: Server;
  let baseUrl: string;

  test.beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/redirect-me') {
        res.writeHead(301, { Location: '/' });
        res.end();
        return;
      }

      if (req.url === '/missing') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!doctype html>
        <html>
          <head>
            <title>Home</title>
            <meta name="description" content="Home page description">
            <link rel="canonical" href="/">
          </head>
          <body>
            <h1>Welcome</h1>
            <a href="/">Home link</a>
            <a href="/missing">Broken link</a>
          </body>
        </html>
      `);
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('runs only the checks required by the detected issue types and groups rows by URL', async () => {
    const sheetDir = await mkdtemp(path.join(tmpdir(), 'audit-runner-test-'));
    const sheetPath = path.join(sheetDir, 'audit.csv');

    await writeFile(
      sheetPath,
      [
        'Page URL,Problem,Expected Value',
        `${baseUrl}/,Missing title,Home`,
        `${baseUrl}/,Wrong title here,Something Else`,
        `${baseUrl}/,Broken link audit,`,
        `${baseUrl}/redirect-me,Redirect check,`,
        `${baseUrl}/,robots.txt missing,`
      ].join('\n'),
      'utf8'
    );

    try {
      const runner = new AuditRunner({ baseUrl, captureScreenshotsOnFailure: false });
      const result = await runner.run(sheetPath);

      expect(result.totalRows).toBe(5);

      expect(result.seoCheckResults).toHaveLength(2);
      expect(result.seoCheckResults.find((check) => check.status === 'passed')?.actual).toBe('Home');
      expect(result.seoCheckResults.find((check) => check.status === 'failed')?.expected).toBe('Something Else');

      expect(result.brokenLinkResults).toHaveLength(2);
      expect(
        result.brokenLinkResults.some((link) => link.link === `${baseUrl}/missing` && link.status === 'FAIL')
      ).toBe(true);
      expect(result.brokenLinkResults.some((link) => link.link === `${baseUrl}/` && link.status === 'PASS')).toBe(
        true
      );

      expect(result.redirectResults).toHaveLength(1);
      expect(result.redirectResults[0]?.originalUrl).toBe(`${baseUrl}/redirect-me`);
      expect(result.redirectResults[0]?.result).toBe('PASS');

      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]?.auditRow.issueType).toBe('robots');
    } finally {
      await rm(sheetDir, { recursive: true, force: true });
    }
  });

  test('marks checks as failed and skips broken-link scanning when navigation fails', async () => {
    const sheetDir = await mkdtemp(path.join(tmpdir(), 'audit-runner-test-'));
    const sheetPath = path.join(sheetDir, 'audit.csv');
    const unreachableUrl = 'http://127.0.0.1:1';

    await writeFile(
      sheetPath,
      [
        'Page URL,Problem,Expected Value',
        `${unreachableUrl}/,Missing title,Home`,
        `${unreachableUrl}/,Broken link audit,`
      ].join('\n'),
      'utf8'
    );

    try {
      const runner = new AuditRunner({ baseUrl: unreachableUrl, captureScreenshotsOnFailure: false });
      const result = await runner.run(sheetPath);

      expect(result.seoCheckResults).toHaveLength(1);
      expect(result.seoCheckResults[0]?.status).toBe('failed');
      expect(result.skipped).toHaveLength(1);
      expect(result.brokenLinkResults).toHaveLength(0);
    } finally {
      await rm(sheetDir, { recursive: true, force: true });
    }
  });
});
