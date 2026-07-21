export interface LighthouseScores {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
}

export interface LighthouseCheckResult {
  url: string;
  scores: LighthouseScores;
  fetchedAt: string;
  error?: string;
}
