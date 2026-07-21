import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type { Result } from 'axe-core';
import type { AccessibilityCheckResult, AccessibilityViolation } from '../types/accessibility-result.js';

export class AccessibilityChecker {
  async check(page: Page): Promise<AccessibilityCheckResult> {
    const axeResults = await new AxeBuilder({ page }).analyze();

    const violations: AccessibilityViolation[] = axeResults.violations.map((violation: Result) => ({
      id: violation.id,
      impact: (violation.impact as AccessibilityViolation['impact']) ?? null,
      description: violation.description,
      helpUrl: violation.helpUrl,
      nodeCount: violation.nodes.length
    }));

    return {
      url: page.url(),
      status: violations.length === 0 ? 'PASS' : 'FAIL',
      violations,
      passCount: axeResults.passes.length,
      incompleteCount: axeResults.incomplete.length,
      fetchedAt: new Date().toISOString()
    };
  }
}
