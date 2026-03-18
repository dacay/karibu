import { Mastra } from '@mastra/core';
import { createOpenAI } from '@ai-sdk/openai';
import { createDeepgram } from '@ai-sdk/deepgram';
import { env } from '../config/env.js';

// OpenAI provider instance (used by both Mastra and direct AI SDK calls)
export const openai = createOpenAI({
  apiKey: env.OPENAI_API_KEY,
});

// Deepgram provider instance (used for TTS)
export const deepgram = createDeepgram({
  apiKey: env.DEEPGRAM_API_KEY,
});

// Mastra instance — agents and workflows will be registered here as they're built
export const mastra = new Mastra({});
