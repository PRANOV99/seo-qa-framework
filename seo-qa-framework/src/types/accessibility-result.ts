export interface AccessibilityViolation {
  id: string;
  impact: 'minor' | 'moderate' | 'serious' | 'critical' | null;
  description: string;
  helpUrl: string;
  nodeCount: number;
}

export interface AccessibilityCheckResult {
  url: string;
  status: 'PASS' | 'FAIL';
  violations: AccessibilityViolation[];
  passCount: number;
  incompleteCount: number;
  fetchedAt: string;
}
