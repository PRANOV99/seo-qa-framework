import type { SeoCheck } from './seo-check.js';
import { AltTextCheck } from './alt-text-check.js';
import { CanonicalCheck } from './canonical-check.js';
import { H1Check } from './h1-check.js';
import { H2Check } from './h2-check.js';
import { MetaDescriptionCheck } from './meta-description-check.js';
import { MetaTitleCheck } from './meta-title-check.js';
import { OpenGraphCheck } from './open-graph-check.js';
import { TwitterCardCheck } from './twitter-card-check.js';
import { BrokenLinkChecker } from './broken-link-check.js';
import { RedirectChecker } from './redirect-check.js';
export const seoChecks: SeoCheck[] = [
  new MetaTitleCheck(),
  new MetaDescriptionCheck(),
  new CanonicalCheck(),
  new H1Check(),
  new H2Check(),
  new AltTextCheck(),
  new OpenGraphCheck(),
  new TwitterCardCheck()
];

export {
 AltTextCheck,
  BrokenLinkChecker,
  CanonicalCheck,
  H1Check,
  H2Check,
  MetaDescriptionCheck,
  MetaTitleCheck,
  OpenGraphCheck,
  RedirectChecker,
  TwitterCardCheck
};
