import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';

/**
 * Picks the model from the environment so the same code runs on either provider.
 * API keys are read by the provider packages themselves:
 * ANTHROPIC_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY.
 */
export function modelFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LanguageModel {
  const modelId = env.LLM_MODEL;
  if (!modelId) throw new Error('LLM_MODEL is not set. See .env.example.');
  switch (env.LLM_PROVIDER) {
    case 'anthropic':
      return anthropic(modelId);
    case 'google':
      return google(modelId);
    default:
      throw new Error(
        'LLM_PROVIDER must be "anthropic" or "google". See .env.example.',
      );
  }
}
