export type SeoCheckStatus = 'passed' | 'failed' | 'skipped' | 'warning';

export type DiffSegmentType = 'same' | 'added' | 'removed' | 'changed';

/**
 * One aligned unit of a word-level diff between an expected and actual text
 * value. 'same'/'removed'/'changed' carry `expected`; 'same'/'added'/'changed'
 * carry `actual`. Populated for any blog-content check that fails with a
 * genuine value to compare against (paragraphs, headings, Meta Title/
 * Description, H1, canonical URL, slug, hyperlinks) — omitted when there is
 * nothing to diff against (e.g. content reported as outright missing).
 */
export interface DiffSegment {
  type: DiffSegmentType;
  expected?: string;
  actual?: string;
}

export interface SeoCheckResult {
  url: string;
  checkType: string;
  status: SeoCheckStatus;
  expected?: string;
  actual?: string;
  message?: string;
  screenshotPath?: string;
  /** Word-level diff, present only when a paragraph comparison fails with a genuine text change. */
  diff?: DiffSegment[];
}
