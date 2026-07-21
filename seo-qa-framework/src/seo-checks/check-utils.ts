import type { SeoAuditRow } from '../types/audit.js';
import type { SeoCheckResult, SeoCheckStatus } from '../types/check-result.js';

export function normalizeText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeForComparison(value: string | undefined): string {
  return normalizeText(value).toLowerCase();
}

export function hasExpectedValue(auditRow: SeoAuditRow): boolean {
  return normalizeText(auditRow.expectedValue) !== '';
}

export function expectedMatchesActual(expected: string | undefined, actual: string | undefined): boolean {
  return normalizeForComparison(expected) === normalizeForComparison(actual);
}

export function createCheckResult(params: {
  auditRow: SeoAuditRow;
  status: SeoCheckStatus;
  actual?: string;
  message?: string;
}): SeoCheckResult {
  return {
    url: params.auditRow.url,
    checkType: params.auditRow.checkType,
    status: params.status,
    expected: params.auditRow.expectedValue,
    actual: params.actual,
    message: params.message
  };
}

export function evaluateExpectedOrPresence(params: {
  auditRow: SeoAuditRow;
  actual?: string;
  missingMessage: string;
  mismatchMessage: string;
  passMessage: string;
}): SeoCheckResult {
  const actual = normalizeText(params.actual);

  if (!actual) {
    return createCheckResult({
      auditRow: params.auditRow,
      status: 'failed',
      actual,
      message: params.missingMessage
    });
  }

  if (hasExpectedValue(params.auditRow) && !expectedMatchesActual(params.auditRow.expectedValue, actual)) {
    return createCheckResult({
      auditRow: params.auditRow,
      status: 'failed',
      actual,
      message: params.mismatchMessage
    });
  }

  return createCheckResult({
    auditRow: params.auditRow,
    status: 'passed',
    actual,
    message: params.passMessage
  });
}
