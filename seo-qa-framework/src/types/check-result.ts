export type SeoCheckStatus = 'passed' | 'failed' | 'skipped' | 'warning';

export interface SeoCheckResult {
  url: string;
  checkType: string;
  status: SeoCheckStatus;
  expected?: string;
  actual?: string;
  message?: string;
  screenshotPath?: string;
}
