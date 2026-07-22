import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeWordDiff, normalizeQuotes, summarizeWordDiff } from '../../src/blog/text-diff.js';

describe('normalizeQuotes', () => {
  it('converts curly single quotes/apostrophes to straight ones', () => {
    assert.equal(normalizeQuotes('Mokila’s emergence'), "Mokila's emergence");
    assert.equal(normalizeQuotes('‘quoted’'), "'quoted'");
  });

  it('converts curly double quotes to straight ones', () => {
    assert.equal(normalizeQuotes('“hello”'), '"hello"');
  });

  it('leaves already-straight quotes unchanged', () => {
    assert.equal(normalizeQuotes(`It's "fine".`), `It's "fine".`);
  });

  it('leaves unrelated text unchanged', () => {
    assert.equal(normalizeQuotes('No quotes here at all.'), 'No quotes here at all.');
  });
});

describe('computeWordDiff', () => {
  it('returns all "same" segments for identical text', () => {
    const diff = computeWordDiff('The quick brown fox', 'The quick brown fox');
    assert.ok(diff.every((seg) => seg.type === 'same'));
    assert.equal(diff.length, 4);
  });

  it('is case-insensitive when deciding sameness', () => {
    const diff = computeWordDiff('The Quick Brown Fox', 'the quick brown fox');
    assert.ok(diff.every((seg) => seg.type === 'same'),
      'Case-only differences should not be reported as changes.');
  });

  it('detects a single substituted word as a "changed" segment', () => {
    const diff = computeWordDiff('the lazy dog sleeps', 'the sleepy dog sleeps');
    const changed = diff.filter((seg) => seg.type === 'changed');
    assert.equal(changed.length, 1);
    assert.equal(changed[0]?.expected, 'lazy');
    assert.equal(changed[0]?.actual, 'sleepy');
  });

  it('detects a missing word as a "removed" segment', () => {
    const diff = computeWordDiff('the quick brown fox jumps', 'the quick fox jumps');
    const removed = diff.filter((seg) => seg.type === 'removed');
    assert.equal(removed.length, 1);
    assert.equal(removed[0]?.expected, 'brown');
  });

  it('detects an inserted word as an "added" segment', () => {
    const diff = computeWordDiff('the quick fox jumps', 'the quick brown fox jumps');
    const added = diff.filter((seg) => seg.type === 'added');
    assert.equal(added.length, 1);
    assert.equal(added[0]?.actual, 'brown');
  });

  it('preserves surrounding matching words as "same" segments around a change', () => {
    const diff = computeWordDiff('one two three four five', 'one two THREE four five');
    assert.equal(diff[0]?.type, 'same');
    assert.equal(diff[1]?.type, 'same');
    assert.equal(diff[3]?.type, 'same');
    assert.equal(diff[4]?.type, 'same');
  });
});

describe('summarizeWordDiff', () => {
  it('summarizes a single word change with an example', () => {
    const diff = computeWordDiff('the lazy dog', 'the sleepy dog');
    const summary = summarizeWordDiff(diff);
    assert.match(summary, /1 word changed/);
    assert.match(summary, /"lazy" → "sleepy"/);
  });

  it('summarizes missing and added words together', () => {
    const diff = computeWordDiff('the quick brown fox', 'the quick fox swiftly');
    const summary = summarizeWordDiff(diff);
    assert.match(summary, /missing/);
    assert.match(summary, /added/);
  });
});
