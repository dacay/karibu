import { Hono } from 'hono';
import { streamText, type UIMessage, createIdGenerator, convertToModelMessages, experimental_generateSpeech as generateSpeech, experimental_transcribe as transcribe } from 'ai';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { authMiddleware } from '../middleware/auth.js';
import { openai, elevenlabs } from '../ai/mastra.js';
import { saveChat } from '../services/chat.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

const chat = new Hono();

// All chat routes require authentication
chat.use('*', authMiddleware());

//TODO Change this
const ML_SYSTEM_PROMPT = `You are a microlearning assistant for workplace training. Your role is to deliver short, focused learning interactions that help employees build skills and retain knowledge.

Guidelines:
- Keep responses concise and focused on the learning objective
- Use simple, clear language
- Ask one question at a time to check understanding
- Provide encouraging but honest feedback
- Adapt to the learner's level based on their responses`;

const mlChatSchema = z.object({
  chatId: z.string().min(1),
  // parts is a complex discriminated union in the AI SDK — validate shape loosely and cast
  messages: z.array(z.object({
    id: z.string(),
    role: z.enum(['user', 'assistant', 'system']),
    parts: z.array(z.record(z.string(), z.unknown())),
  })).min(1),
});

/**
 * POST /chat/ml
 * Streaming chat endpoint for microlearning conversations.
 * Compatible with the useChat hook from the Vercel AI SDK.
 */
chat.post('/ml', zValidator('json', mlChatSchema), async (c) => {

  const { chatId } = c.req.valid('json');
  const messages = c.req.valid('json').messages as UIMessage[];

  // Get auth context
  const auth = c.get('auth');

  // Stream text
  const result = streamText({
    model: openai('gpt-4o'),
    system: ML_SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
  });

  // Return stream response
  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    generateMessageId: createIdGenerator({ prefix: 'msg', size: 16 }),
    onFinish: ({ messages: updatedMessages }) => {
      saveChat({
        chatId,
        messages: updatedMessages,
        userId: auth.userId,
        organizationId: auth.organizationId,
        type: 'microlearning',
      }).catch((err) => {
        logger.error({ err, chatId }, 'Failed to persist chat after stream finish.');
      });
    },
  });
});

const ASSISTANT_SYSTEM_PROMPT = `You are a helpful assistant. Answer questions clearly and concisely.`;

const assistantChatSchema = z.object({
  chatId: z.string().min(1),
  messages: z.array(z.object({
    id: z.string(),
    role: z.enum(['user', 'assistant', 'system']),
    parts: z.array(z.record(z.string(), z.unknown())),
  })).min(1),
});

/**
 * POST /chat/assistant
 * Streaming chat endpoint for free-form assistant conversations.
 * Compatible with the useChat hook from the Vercel AI SDK.
 */
chat.post('/assistant', zValidator('json', assistantChatSchema), async (c) => {

  const { chatId } = c.req.valid('json');
  const messages = c.req.valid('json').messages as UIMessage[];

  const auth = c.get('auth');

  const result = streamText({
    model: openai('gpt-4o'),
    system: ASSISTANT_SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    generateMessageId: createIdGenerator({ prefix: 'msg', size: 16 }),
    onFinish: ({ messages: updatedMessages }) => {
      saveChat({
        chatId,
        messages: updatedMessages,
        userId: auth.userId,
        organizationId: auth.organizationId,
        type: 'discussion',
      }).catch((error) => {
        logger.error({ error, chatId }, 'Failed to persist assistant chat after stream finish.');
      });
    },
  });
});

const ttsSchema = z.object({
  text: z.string().min(1).max(4000),
  voiceId: z.string().min(1).optional(),
});

const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // ElevenLabs "Rachel"

/**
 * POST /chat/tts
 * Convert text to speech using ElevenLabs and stream back MP3 audio.
 */
chat.post('/tts', zValidator('json', ttsSchema), async (c) => {

  if (!env.ELEVENLABS_API_KEY) {
    return c.json({ error: 'TTS is not configured on this server.' }, 400);
  }

  const { text, voiceId = DEFAULT_VOICE_ID } = c.req.valid('json');

  try {

    const result = await generateSpeech({
      model: elevenlabs.speech('eleven_multilingual_v2'),
      text,
      voice: voiceId,
    });

    return new Response(result.audio.uint8Array, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    });

  } catch (error) {

    logger.error({ error }, 'TTS synthesis failed.');

    return c.json({ error: 'Failed to synthesize speech.' }, 500);
  }
});

/**
 * POST /chat/transcribe
 * Transcribe an audio file to text using ElevenLabs scribe_v1.
 * Accepts multipart/form-data with an `audio` field.
 */
chat.post('/transcribe', async (c) => {

  if (!env.ELEVENLABS_API_KEY) {
    return c.json({ error: 'Transcription is not configured on this server.' }, 400);
  }

  try {

    const body = await c.req.parseBody();
    const file = body['audio'] as File | undefined;

    if (!file) {
      return c.json({ error: 'No audio file provided.' }, 400);
    }

    const result = await transcribe({
      model: elevenlabs.transcription('scribe_v1'),
      audio: new Uint8Array(await file.arrayBuffer()),
      providerOptions: {
        elevenlabs: { languageCode: 'en' },
      },
    });

    return c.json({ text: result.text });

  } catch (error) {

    logger.error({ error }, 'Transcription failed.');

    return c.json({ error: 'Failed to transcribe audio.' }, 500);
  }
});

export default chat;
