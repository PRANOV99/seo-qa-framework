export interface RedirectResult {
  originalUrl: string;
  finalUrl: string;
  statusCode: number;
  redirectCount: number;
  responseTime: number;

  result: "PASS" | "FAIL" | "WARNING";

  recommendation: string;
}