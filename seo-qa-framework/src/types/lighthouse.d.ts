declare module 'lighthouse' {
  export interface LighthouseFlags {
    port?: number;
    output?: string | string[];
    logLevel?: 'silent' | 'error' | 'warn' | 'info' | 'verbose';
    onlyCategories?: string[];
    [key: string]: unknown;
  }

  export interface LighthouseCategoryResult {
    id: string;
    title: string;
    score: number | null;
  }

  export interface LighthouseRunnerResult {
    lhr: {
      categories: Record<string, LighthouseCategoryResult>;
      finalUrl: string;
      requestedUrl: string;
      fetchTime: string;
      runtimeError?: { code: string; message: string };
    };
    report: string | string[];
  }

  export default function lighthouse(
    url: string,
    flags?: LighthouseFlags,
    config?: unknown
  ): Promise<LighthouseRunnerResult | undefined>;
}
