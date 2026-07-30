import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  BASE_URL: z.string().url().default('https://example.com'),
  AUDIT_SHEET_PATH: z.string().default('./audit-sheets/sample.csv'),
  REPORT_OUTPUT_DIR: z.string().default('./reports'),
  SCREENSHOT_DIR: z.string().default('./screenshots'),
  HISTORY_DIR: z.string().default('./history'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  CI: z.coerce.boolean().default(false),
  TEST_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  EXPECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  ACTION_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  NAVIGATION_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  HEADLESS: z.coerce.boolean().default(true),
  VIEWPORT_WIDTH: z.coerce.number().int().positive().default(1440),
  VIEWPORT_HEIGHT: z.coerce.number().int().positive().default(900),
  /** Max number of blog documents that can be submitted together in one Blog Testing batch (web API). */
  MAX_BLOG_BATCH_SIZE: z.coerce.number().int().positive().default(8),
  /** How many blogs in a batch are crawled/compared at the same time, sharing one browser (each still gets its own isolated BrowserContext). */
  BLOG_BATCH_CONCURRENCY: z.coerce.number().int().positive().default(4)
});

export const env = envSchema.parse(process.env);

export type Env = typeof env;

/**
 * True when running in a production deployment (e.g. Render).
 * Used to apply container-safe browser launch flags without changing
 * local development behavior.
 */
export const isProduction = process.env.NODE_ENV === 'production';
