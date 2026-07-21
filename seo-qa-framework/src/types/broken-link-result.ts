export interface BrokenLinkResult {
  pageUrl: string;
  link: string;
  linkType: "Internal" | "External";
  statusCode: number;
  status: "PASS" | "FAIL" | "WARNING";
  message: string;
}