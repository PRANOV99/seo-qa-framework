import type { ReportData } from '../types/report.js';

export function generateJsonReport(reportData: ReportData): string {
  return JSON.stringify(reportData, null, 2);
}
