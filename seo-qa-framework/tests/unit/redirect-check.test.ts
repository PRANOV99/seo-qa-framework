import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from '@playwright/test';
import { RedirectChecker } from '../../src/seo-checks/redirect-check.js';

describe('RedirectChecker (live HTTP, no browser required)', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
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

      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('follows redirects and reports the final destination as passing', async () => {
    const apiContext = await request.newContext();

    try {
      const result = await new RedirectChecker(apiContext).check(`${baseUrl}/redirect-me`);

      assert.equal(result.originalUrl, `${baseUrl}/redirect-me`);
      assert.equal(result.finalUrl, `${baseUrl}/`);
      assert.equal(result.statusCode, 200);
      assert.equal(result.redirectCount, 1);
      assert.equal(result.result, 'PASS');
    } finally {
      await apiContext.dispose();
    }
  });

  it('reports a failing result for a missing page', async () => {
    const apiContext = await request.newContext();

    try {
      const result = await new RedirectChecker(apiContext).check(`${baseUrl}/missing`);

      assert.equal(result.statusCode, 404);
      assert.equal(result.result, 'FAIL');
    } finally {
      await apiContext.dispose();
    }
  });
});
