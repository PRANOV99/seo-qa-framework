import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChecksByType,
  groupAuditRowsByUrl,
  resolveAuditUrl,
  resolveCheckDispatch
} from '../../src/runner/audit-runner-utils.js';
import type { SeoAuditRow, SeoIssueType } from '../../src/types/audit.js';
import type { SeoCheck } from '../../src/seo-checks/seo-check.js';

function auditRow(issueType: SeoIssueType, overrides: Partial<SeoAuditRow> = {}): SeoAuditRow {
  return {
    url: 'https://example.com/page',
    checkType: issueType,
    issueType,
    sourceRowNumber: 2,
    raw: {},
    ...overrides
  };
}

const fakeTitleCheck: SeoCheck = {
  type: 'title',
  run: async () => ({ url: '', checkType: '', status: 'passed' })
};

describe('resolveAuditUrl', () => {
  it('returns absolute URLs unchanged', () => {
    assert.equal(resolveAuditUrl('https://other.com/page', 'https://example.com'), 'https://other.com/page');
  });

  it('resolves relative paths against the base URL', () => {
    assert.equal(resolveAuditUrl('/about', 'https://example.com'), 'https://example.com/about');
  });
});

describe('groupAuditRowsByUrl', () => {
  it('groups rows that resolve to the same URL so the runner visits each page once', () => {
    const rows = [
      auditRow('title', { url: 'https://example.com/page' }),
      auditRow('h1', { url: '/page' }),
      auditRow('h2', { url: 'https://example.com/about' })
    ];

    const grouped = groupAuditRowsByUrl(rows, 'https://example.com');

    assert.equal(grouped.size, 2);
    assert.equal(grouped.get('https://example.com/page')?.length, 2);
    assert.equal(grouped.get('https://example.com/about')?.length, 1);
  });
});

describe('resolveCheckDispatch', () => {
  it('dispatches to a registered SeoCheck when the issue type matches', () => {
    const checksByType = buildChecksByType([fakeTitleCheck]);
    const dispatch = resolveCheckDispatch(auditRow('title'), checksByType);

    assert.equal(dispatch.kind, 'seoCheck');
  });

  it('dispatches redirect and brokenLink issue types even without a registered SeoCheck', () => {
    const checksByType = buildChecksByType([]);

    assert.equal(resolveCheckDispatch(auditRow('redirect'), checksByType).kind, 'redirect');
    assert.equal(resolveCheckDispatch(auditRow('brokenLink'), checksByType).kind, 'brokenLink');
  });

  it('dispatches accessibility and performance issue types so axe/Lighthouse run only when the sheet calls for them', () => {
    const checksByType = buildChecksByType([]);

    assert.equal(resolveCheckDispatch(auditRow('accessibility'), checksByType).kind, 'accessibility');
    assert.equal(resolveCheckDispatch(auditRow('performance'), checksByType).kind, 'performance');
  });

  it('reports unsupported issue types that have no implemented check', () => {
    const checksByType = buildChecksByType([]);
    const dispatch = resolveCheckDispatch(auditRow('sitemap'), checksByType);

    assert.equal(dispatch.kind, 'unsupported');
  });
});
