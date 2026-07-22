import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BlogBatchRunner, type BlogBatchItem, type BlogRunnerLike } from '../../src/runner/blog-batch-runner.js';
import { buildSampleAuditRunResult } from './fixtures.js';

function items(count: number): BlogBatchItem[] {
  return Array.from({ length: count }, (_, i) => ({
    docxPath: `/tmp/blog-${i + 1}.docx`,
    url: `https://example.com/blog/post-${i + 1}`,
    filename: `Blog ${i + 1}.docx`
  }));
}

describe('BlogBatchRunner', () => {
  it('processes every item sequentially, in order, never in parallel', async () => {
    const callOrder: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const fakeRunner: BlogRunnerLike = {
      run: async (docxPath) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        callOrder.push(docxPath);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return buildSampleAuditRunResult({ sourcePath: docxPath, kind: 'blog' });
      }
    };

    const batch = new BlogBatchRunner({}, fakeRunner);
    const results = await batch.run(items(3));

    assert.deepEqual(callOrder, ['/tmp/blog-1.docx', '/tmp/blog-2.docx', '/tmp/blog-3.docx'],
      'Items must be started in order.');
    assert.equal(maxInFlight, 1, 'Items must never run concurrently.');
    assert.equal(results.length, 3);
    assert.ok(results.every((r) => r.status === 'done'));
  });

  it('isolates a failing item so the rest of the batch still completes', async () => {
    const fakeRunner: BlogRunnerLike = {
      run: async (docxPath) => {
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

  it('reports start and completion progress for every item, in order', async () => {
    const fakeRunner: BlogRunnerLike = {
      run: async (docxPath) => buildSampleAuditRunResult({ sourcePath: docxPath, kind: 'blog' })
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

    assert.deepEqual(started, [0, 1, 2]);
    assert.deepEqual(completed, [0, 1, 2]);
  });
});
