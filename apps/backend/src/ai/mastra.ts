import { Mastra } from '@mastra/core';
import { createOpenAI } from '@ai-sdk/openai';
import { createElevenLabs } from '@ai-sdk/elevenlabs';
import { env } from '../config/env.js';

// OpenAI provider instance (used by both Mastra and direct AI SDK calls)
export const openai = createOpenAI({
  apiKey: env.OPENAI_API_KEY,
});

// ElevenLabs provider instance (used for TTS)
export const elevenlabs = createElevenLabs({
  apiKey: env.ELEVENLABS_API_KEY,
});

// Mastra instance — agents and workflows will be registered here as they're built
export const mastra = new Mastra({});
