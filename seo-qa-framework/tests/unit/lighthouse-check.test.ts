import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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

describe('LighthouseChecker child-process crash safety', () => {
  // Not a mock of chrome-launcher itself (this project has no ESM-mocking
  // infrastructure and a real Lighthouse run is slow) — this locks in the
  // underlying Node.js behaviour that check()'s `chrome.process?.on('error',
  // ...)` line (see lighthouse-check.ts) depends on and guards against:
  // chrome-launcher spawns Chrome as a raw child process with NO 'error'
  // listener of its own (confirmed in its source), and Node crashes the
  // ENTIRE process — not just the current call — when an EventEmitter
  // 'error' event has zero listeners — meaning a single transient Chrome
  // spawn failure (antivirus locking the freshly-written executable,
  // momentary resource exhaustion, etc.) could take the whole API server
  // down mid-audit, failing every other in-flight request with "Failed to
  // fetch", not just the one whose Lighthouse check actually errored.
  it('crashes the process when a child process emits "error" with no listener attached', async () => {
    const script = `
      const child = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 2000)']);
      child.emit('error', new Error('synthetic spawn failure'));
      console.log('SURVIVED');
    `;
    const child = spawn(process.execPath, ['-e', script]);
    const exitCode = await new Promise((resolve) => child.on('exit', resolve));

    assert.notEqual(exitCode, 0, 'An unlistened "error" event should crash the child process (Node\'s documented behaviour) — if this fails, Node\'s behaviour changed and the fix in lighthouse-check.ts may no longer be necessary.');
  });

  it('does NOT crash the process once an "error" listener is attached — the exact fix in check()', async () => {
    const script = `
      const child = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 2000)']);
      child.on('error', () => {});
      child.emit('error', new Error('synthetic spawn failure'));
      console.log('SURVIVED');
    `;
    const child = spawn(process.execPath, ['-e', script]);
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    const exitCode = await new Promise((resolve) => child.on('exit', resolve));

    assert.equal(exitCode, 0);
    assert.match(stdout, /SURVIVED/);
  });
});
