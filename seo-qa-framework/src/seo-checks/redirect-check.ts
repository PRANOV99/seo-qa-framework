import { APIRequestContext } from "@playwright/test";
import type { RedirectResult } from "../types/redirect-result.js";

export class RedirectChecker {
  constructor(private request: APIRequestContext) {}

  async check(url: string): Promise<RedirectResult> {
    const startTime = Date.now();

    try {
      const response = await this.request.get(url, {
        maxRedirects: 10,
        timeout: 30000,
      });

      const endTime = Date.now();

      const status = response.status();
      const finalUrl = response.url();

      let result: "PASS" | "FAIL" | "WARNING";
      let recommendation = "";

      switch (status) {
        case 200:
          result = "PASS";
          recommendation = "Page is accessible.";
          break;

        case 301:
          result = "PASS";
          recommendation = "Permanent redirect working correctly.";
          break;

        case 302:
          result = "WARNING";
          recommendation =
            "Temporary redirect found. Verify if a 301 redirect is expected.";
          break;

        case 404:
          result = "FAIL";
          recommendation =
            "Page not found. Restore the page or configure a 301 redirect.";
          break;

        default:
          if (status >= 500) {
            result = "FAIL";
            recommendation =
              "Server error detected. Check server configuration.";
          } else {
            result = "WARNING";
            recommendation = "Unexpected HTTP response.";
          }
      }

      return {
        originalUrl: url,
        finalUrl,
        statusCode: status,
        redirectCount:
          finalUrl !== url ? 1 : 0,
        responseTime: endTime - startTime,
        result,
        recommendation,
      };
    } catch (error: any) {
      return {
        originalUrl: url,
        finalUrl: "",
        statusCode: 0,
        redirectCount: 0,
        responseTime: 0,
        result: "FAIL",
        recommendation: error.message,
      };
    }
  }
}