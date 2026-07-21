import type { Page } from '@playwright/test';
import type { SeoAuditRow } from '../types/audit.js';
import type { SeoCheckResult } from '../types/check-result.js';

export interface SeoCheck {
  readonly type: string;
  run(page: Page, auditRow: SeoAuditRow): Promise<SeoCheckResult>;
}
