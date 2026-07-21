import type { Page } from "@playwright/test";
import type { BrokenLinkResult } from "../types/broken-link-result.js";

export class BrokenLinkChecker {
  async check(page: Page): Promise<BrokenLinkResult[]> {
    const pageUrl = page.url();

    const links = await page.$$eval("a[href]", (elements) =>
      elements.map((el) => (el as HTMLAnchorElement).href)
    );

    const results: BrokenLinkResult[] = [];

    for (const link of links) {
      try {
        const response = await page.request.get(link, {
          timeout: 15000,
          maxRedirects: 5,
        });

        const statusCode = response.status();

        results.push({
          pageUrl,
          link,
          linkType: link.startsWith(new URL(pageUrl).origin)
            ? "Internal"
            : "External",
          statusCode,
          status:
            statusCode >= 200 && statusCode < 400
              ? "PASS"
              : "FAIL",
          message:
            statusCode >= 200 && statusCode < 400
              ? "Working"
              : "Broken Link",
        });
      } catch {
        results.push({
          pageUrl,
          link,
          linkType: link.startsWith(new URL(pageUrl).origin)
            ? "Internal"
            : "External",
          statusCode: 0,
          status: "FAIL",
          message: "Unable to connect",
        });
      }
    }

    return results;
  }
}