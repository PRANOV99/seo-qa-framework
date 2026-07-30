import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import { BlogBatchRunner, type BlogBatchItem, type BlogRunnerLike, type BrowserManagerLike } from '../../src/runner/blog-batch-runner.js';
import { buildSampleAuditRunResult } from './fixtures.js';

function items(count: number): BlogBatchItem[] {
  return Array.from({ length: count }, (_, i) => ({
    docxSource: `/tmp/blog-${i + 1}.docx`,
    url: `https://example.com/blog/post-${i + 1}`,
    filename: `Blog ${i + 1}.docx`
  }));
}

describe('BlogBatchRunner', () => {
  it('runs items with bounded concurrency instead of one at a time', async () => {
    const callOrder: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const fakeRunner: BlogRunnerLike = {
      run: async (docxSource) => {
        const docxPath = docxSource as string;
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        callOrder.push(docxPath);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return buildSampleAuditRunResult({ sourcePath: docxPath, kind: 'blog' });
      }
    };

    // Explicit concurrency of 2 (4th constructor arg) so the assertion isn't
    // tied to whatever testConfig.blogBatchConcurrency happens to default to.
    const batch = new BlogBatchRunner({}, fakeRunner, undefined, 2);
    const results = await batch.run(items(4));

    assert.equal(callOrder.length, 4, 'Every item must still be started exactly once.');
    assert.deepEqual([...callOrder].sort(), ['/tmp/blog-1.docx', '/tmp/blog-2.docx', '/tmp/blog-3.docx', '/tmp/blog-4.docx']);
    assert.equal(maxInFlight, 2, 'Concurrency must reach the configured cap, not run strictly one at a time.');
    assert.equal(results.length, 4);
    assert.ok(results.every((r) => r.status === 'done'));
  });

  it('never runs more items at once than the configured concurrency cap', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const fakeRunner: BlogRunnerLike = {
      run: async (docxSource) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return buildSampleAuditRunResult({ sourcePath: docxSource as string, kind: 'blog' });
      }
    };

    const batch = new BlogBatchRunner({}, fakeRunner, undefined, 3);
    await batch.run(items(8));

    assert.ok(maxInFlight <= 3, `Expected at most 3 concurrent items, got ${maxInFlight}.`);
  });

  it('returns results in the original item order, even when later items finish first', async () => {
    const fakeRunner: BlogRunnerLike = {
      run: async (docxSource) => {
        const docxPath = docxSource as string;
        // The first item takes longest, so without index-based ordering the
        // faster later items would settle (and be pushed) first.
        const delay = docxPath.includes('blog-1') ? 20 : 1;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return buildSampleAuditRunResult({ sourcePath: docxPath, kind: 'blog' });
      }
    };

    const batch = new BlogBatchRunner({}, fakeRunner, undefined, 4);
    const results = await batch.run(items(4));

    assert.deepEqual(results.map((r) => r.result?.sourcePath), [
      '/tmp/blog-1.docx', '/tmp/blog-2.docx', '/tmp/blog-3.docx', '/tmp/blog-4.docx'
    ]);
  });

  it('isolates a failing item so the rest of the batch still completes', async () => {
    const fakeRunner: BlogRunnerLike = {
      run: async (docxSource) => {
        const docxPath = docxSource as string;
        if (docxPath.includes('blog-2')) {
          throw new Error('Playwright navigation timeout');
        }
        return buildSampleAuditRunResult({ sourcePath: docxPath, kind: 'blog' });
      }
    };

    const batch = new BlogBatchRunner({}, fakeRunner);
    const results = await batch.run(items(3));

    assert.equal(results.length, 3, 'All 3 items must produce a result, including the failed one.');
    assert.equal(results[0]?.status, 'done');
    assert.equal(results[1]?.status, 'error');
    assert.match(results[1]?.error ?? '', /Playwright navigation timeout/);
    assert.equal(results[2]?.status, 'done', 'The item after the failure must still run.');
  });

  it('reports start and completion progress for every item, each with its own correct index', async () => {
    const fakeRunner: BlogRunnerLike = {
      run: async (docxSource) => buildSampleAuditRunResult({ sourcePath: docxSource as string, kind: 'blog' })
    };

    const started: number[] = [];
    const completed: number[] = [];

    const batch = new BlogBatchRunner({}, fakeRunner);
    await batch.run(items(3), {
      onStart: (index, total) => { assert.equal(total, 3); started.push(index); },
      onComplete: (index, total, _item, result) => {
        assert.equal(total, 3);
        assert.equal(result.status, 'done');
        completed.push(index);
      }
    });

    // Concurrent execution means start/completion order isn't guaranteed —
    // only that every index is reported exactly once, on each side.
    assert.deepEqual([...started].sort(), [0, 1, 2]);
    assert.deepEqual([...completed].sort(), [0, 1, 2]);
  });

  it('launches exactly ONE shared browser for the whole batch and passes it to every item', async () => {
    const FAKE_BROWSER = { id: 'fake-browser' } as unknown as Browser;
    let launchCount = 0;
    let closeCount = 0;
    const receivedBrowsers: unknown[] = [];

    const fakeBrowserManager: BrowserManagerLike = {
      launch: async () => { launchCount++; return FAKE_BROWSER; },
      close: async () => { closeCount++; }
    };
    const fakeRunner: BlogRunnerLike = {
      run: async (docxSource, _url, browser) => {
        receivedBrowsers.push(browser);
        return buildSampleAuditRunResult({ sourcePath: docxSource as string, kind: 'blog' });
      }
    };

    const batch = new BlogBatchRunner({}, fakeRunner, fakeBrowserManager);
    const results = await batch.run(items(5));

    assert.equal(launchCount, 1, 'Exactly one browser must be launched for a 5-item batch, not one per item.');
    assert.equal(closeCount, 1, 'The shared browser must be closed exactly once, after the whole batch settles.');
    assert.equal(receivedBrowsers.length, 5);
    assert.ok(receivedBrowsers.every((b) => b === FAKE_BROWSER), 'Every item must receive the SAME shared browser instance.');
    assert.ok(results.every((r) => r.status === 'done'));
  });

  it('still closes the shared browser exactly once even when some items fail', async () => {
    let closeCount = 0;
    const fakeBrowserManager: BrowserManagerLike = {
      launch: async () => ({} as unknown as Browser),
      close: async () => { closeCount++; }
    };
    const fakeRunner: BlogRunnerLike = {
      run: async (docxSource) => {
        const docxPath = docxSource as string;
        if (docxPath.includes('blog-2')) throw new Error('boom');
        return buildSampleAuditRunResult({ sourcePath: docxPath, kind: 'blog' });
      }
    };

    const batch = new BlogBatchRunner({}, fakeRunner, fakeBrowserManager);
    const results = await batch.run(items(3));

    assert.equal(closeCount, 1);
    assert.equal(results[1]?.status, 'error');
  });

  it('does not launch a browser at all for an empty batch', async () => {
    let launchCount = 0;
    const fakeBrowserManager: BrowserManagerLike = {
      launch: async () => { launchCount++; return {} as unknown as Browser; },
      close: async () => {}
    };
    const fakeRunner: BlogRunnerLike = { run: async () => buildSampleAuditRunResult({ kind: 'blog' }) };

    const batch = new BlogBatchRunner({}, fakeRunner, fakeBrowserManager);
    const results = await batch.run([]);

    assert.equal(launchCount, 0);
    assert.deepEqual(results, []);
  });

  it('passes an already-parsed BlogContent through to the runner unchanged, for re-run items', async () => {
    const parsedContent = {
      h2Headings: ['A heading'], h3Headings: [], h4Headings: [], paragraphs: ['A paragraph.'],
      links: [], boldPhrases: []
    };
    const received: unknown[] = [];
    const fakeRunner: BlogRunnerLike = {
      run: async (docxSource) => {
        received.push(docxSource);
        return buildSampleAuditRunResult({ kind: 'blog' });
      }
    };

    const batch = new BlogBatchRunner({}, fakeRunner);
    await batch.run([{ docxSource: parsedContent, url: 'https://example.com/blog/post', filename: 'Post.docx' }]);

    assert.equal(received.length, 1);
    assert.deepEqual(received[0], parsedContent);
  });
});
