import type { AuditParseResult } from '../types/audit.js';

export interface AuditSheetParser {
  parse(filePath: string): Promise<AuditParseResult>;
}
