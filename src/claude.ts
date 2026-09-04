import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';

let cached: Anthropic | undefined;

/**
 * The shared API client.
 *
 * Built on first use rather than at import time, so that an unconfigured
 * process fails in `main` with a readable message instead of at load.
 */
export function client(): Anthropic {
  cached ??= new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 2 });
  return cached;
}
