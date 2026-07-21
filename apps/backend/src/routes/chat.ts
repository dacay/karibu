import { Hono } from 'hono';
import {
  streamText,
  stepCountIs,
  type UIMessage,
  type ToolSet,
  createIdGenerator,
  convertToModelMessages,
  experimental_generateSpeech as generateSpeech,
  experimental_transcribe as transcribe,
} from 'ai';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, inArray, or, isNull } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import type { UserAuthContext } from '../types/auth.js';
import { openai, deepgram } from '../ai/mastra.js';
import { saveChat, loadChat } from '../services/chat.js';
import { queryDocuments, queryManual } from '../services/chromadb.js';
import { trackEvent, EVENTS } from '../utils/analytics.js';
import { db } from '../db/index.js';
import {
  microlearnings,
  microlearningProgress,
  conversationPatterns,
  avatars,
  dnaTopics,
  dnaSubtopics,
  dnaValues,
  userGroupMembers,
  userGroups,
  microlearningSequenceAssignments,
  chats,
  organizations,
  users,
  LANGUAGE_CODES,
  type LanguageCode,
  type AvatarLocalization,
} from '../db/schema.js';
import { logger } from '../config/logger.js';
import { BUILT_IN_AVATARS } from '../config/built-in-avatars.js';
import { env } from '../config/env.js';
import { notifyMlCompletion } from '../services/completion-webhook.js';
import { isMicrolearningComplete } from '../services/completion-classifier.js';

const chat = new Hono();

// All chat routes require authentication
chat.use('*', authMiddleware());

// ─── Language ───────────────────────────────────────────────────────────────

const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  en: 'English',
  es: 'Spanish',
};

/** Normalize an arbitrary stored value to a supported language, defaulting to English. */
function resolveLanguage(value: string | null | undefined): LanguageCode {
  return (LANGUAGE_CODES as readonly string[]).includes(value ?? '')
    ? (value as LanguageCode)
    : 'en';
}

/**
 * Pick an avatar's localization for a language, falling back to English (the
 * always-present default) so a session always has a voice and persona.
 */
function resolveLocalization(
  localizations: Record<string, AvatarLocalization> | null | undefined,
  language: LanguageCode,
): AvatarLocalization | null {
  if (!localizations) return null;
  return localizations[language] ?? localizations.en ?? null;
}

/**
 * Resolve the persona that drives a chat session, applying the precedence:
 * learner's preferred avatar (pass null for admins so the org default wins) →
 * org default avatar → BUILT_IN_AVATARS[0] (in-code fallback, no query).
 * Returns the persona text for the given language (falling back to English).
 * Voice + photo are resolved separately on the frontend from the same order.
 */
async function resolveSessionAvatar(
  organizationId: string,
  preferredAvatarId: string | null,
  language: LanguageCode,
): Promise<{ name: string; description: string }> {
  // Org default id (always set post-backfill, but may reference a deleted
  // avatar since there is no FK).
  const [org] = await db
    .select({ defaultAvatarId: organizations.defaultAvatarId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  const defaultId = org?.defaultAvatarId ?? null;

  const candidateIds = [preferredAvatarId, defaultId].filter((id): id is string => Boolean(id));
  if (candidateIds.length > 0) {
    const rows = await db
      .select({ id: avatars.id, name: avatars.name, localizations: avatars.localizations })
      .from(avatars)
      .where(and(
        inArray(avatars.id, candidateIds),
        or(isNull(avatars.organizationId), eq(avatars.organizationId, organizationId)),
      ));
    const chosen =
      rows.find((a) => a.id === preferredAvatarId) ??
      rows.find((a) => a.id === defaultId);
    if (chosen) {
      const localization = resolveLocalization(chosen.localizations, language);
      if (localization) return { name: chosen.name, description: localization.description };
    }
  }

  // In-code fallback — no query.
  const fallback = BUILT_IN_AVATARS[0];
  const loc = fallback.localizations[language] ?? fallback.localizations.en;
  return { name: fallback.name, description: loc.description };
}

/** Explicit, always-on instruction telling the model which language to speak. */
function languageDirective(language: LanguageCode): string {
  const name = LANGUAGE_NAMES[language];
  return `\n---\nLANGUAGE: Respond entirely in ${name}. Every message you write, including your opening message, must be in natural, fluent ${name}. Do not switch languages unless the learner explicitly asks you to.`;
}

/**
 * Tool that lets the learner change their language mid-conversation by asking.
 * The enum input guarantees only supported languages can ever be set. On change,
 * `onChange` is invoked so the route can signal the new language to the client.
 */
function makeSetLanguageTool(userId: string, onChange: (language: LanguageCode) => void) {
  return {
    description:
      'Change the learner\'s language preference when they ask to switch languages. Only call this for a supported language. After calling it, continue this and all following messages in the new language.',
    inputSchema: z.object({
      language: z.enum(LANGUAGE_CODES).describe('The language to switch to.'),
    }),
    execute: async ({ language }: { language: LanguageCode }) => {
      try {
        await db.update(users).set({ language }).where(eq(users.id, userId));
        onChange(language);
        return `Language preference updated to ${LANGUAGE_NAMES[language]}. Continue in ${LANGUAGE_NAMES[language]} from now on.`;
      } catch (err) {
        logger.error({ err, userId, language }, 'Failed to update learner language preference.');
        return 'Unable to change the language right now.';
      }
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatLearnerName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string | null {
  const name = [firstName, lastName].filter(Boolean).join(' ').trim();
  return name || null;
}

/**
 * Maps a pattern's response length setting to a system-prompt instruction.
 * Returns null when no length is set (admin opted out).
 */
function responseLengthGuide(responseLength: string | null): string | null {
  switch (responseLength) {
    case 'short':
      return 'RESPONSE LENGTH: Keep responses very short — 1 to 2 short sentences (roughly 15–30 words). Be conversational and get straight to the point with no preamble.';
    case 'medium':
      return 'RESPONSE LENGTH: Keep responses to a short paragraph (roughly 40–90 words), with room for a brief example where it helps.';
    case 'long':
      return 'RESPONSE LENGTH: Give thorough, detailed responses (120+ words), using multiple paragraphs to fully explain the topic.';
    default:
      return null;
  }
}

/**
 * Build the system prompt for a microlearning chat session.
 */
function buildMLSystemPrompt(
  patternPrompt: string,
  topics: Array<{ name: string; description: string }>,
  subtopics: Array<{ name: string; description: string }>,
  dnaKnowledge: string[],
  isCompleted: boolean,
  organizationName: string,
  learnerName: string | null,
  responseLength: string | null,
  persona: { name: string; description: string } | null,
  language: LanguageCode,
): string {

  const parts: string[] = [patternPrompt];

  if (persona) {
    parts.push(
      `\nYOUR PERSONA: You are ${persona.name}. The text below — written in your own voice — is the character and speaking style to embody for the whole session. Let it shape your tone, warmth, and word choice, layered on top of the teaching approach above. It must never override the instructional method, the learning objectives, or the organizational source of truth.\n${persona.description}`,
    );
  }

  const lengthGuide = responseLengthGuide(responseLength);
  if (lengthGuide) {
    parts.push(`\n${lengthGuide}`);
  }

  parts.push(`\nORGANIZATION: ${organizationName}`);

  if (learnerName) {
    parts.push(`LEARNER: ${learnerName}`);
  }

  if (topics.length === 1) {
    parts.push(`\n---\nMICROLEARNING TOPIC: ${topics[0].name}`);
    if (topics[0].description) {
      parts.push(topics[0].description);
    }
  } else if (topics.length > 1) {
    parts.push('\n---\nMICROLEARNING TOPICS:');
    topics.forEach((t) => {
      parts.push(`- ${t.name}${t.description ? `: ${t.description}` : ''}`);
    });
  }

  if (subtopics.length > 0) {
    parts.push('\nLEARNING OBJECTIVES (subtopics to cover):');
    subtopics.forEach((s, i) => {
      parts.push(`${i + 1}. ${s.name}: ${s.description}`);
    });
  }

  if (dnaKnowledge.length > 0) {
    parts.push('\nORGANIZATIONAL KNOWLEDGE (use this as your primary source of truth):');
    dnaKnowledge.forEach((v) => parts.push(`- ${v}`));
  }

  if (isCompleted) {
    parts.push(
      '\nCOMPLETION STATUS: The learner has already completed this microlearning.',
      'You may now answer any questions they have freely, including topics beyond the microlearning.',
    );
  } else {
    parts.push(
      '\nBEHAVIORAL GUIDELINES:',
      '- The learner\'s first message will be "__start__" — this is a system trigger, not typed by the learner. Respond to it by opening the session.',
      '- This is a 5-minute interactive session. Keep messages short and the pace moving.',
      '- Cover all learning objectives listed above during the session.',
      '- Use the organizational knowledge above as your primary source of truth.',
      '- Use the searchKnowledge tool when you need additional context from organizational documents.',
      '- If the learner asks about unrelated topics, acknowledge briefly and redirect back to the session.',
      '- If the learner asks to switch to a language we support, call setLanguage with that language and then continue the session in it. If they ask for a language we do not support, tell them it is not available and keep going in the current language.',
      '- Once ALL objectives have been covered and the learner demonstrates understanding, deliver your closing remarks AND call markLearningComplete in that same response. Never say a closing message and then wait for the learner to reply before calling the tool.',
    );
  }

  parts.push(languageDirective(language));

  parts.push(HIPAA_GUARDRAIL);

  return parts.join('\n');
}

const DEFAULT_ML_SYSTEM_PROMPT = `You are a workplace training instructor. You are the TEACHER. The person you are talking to is the LEARNER — they know nothing about this topic yet and you are here to teach them.

Guidelines:
- YOU start the lesson by introducing the topic and immediately teaching the first concept. Never ask the learner to explain the topic to you.
- Teach in short chunks (2-4 sentences). After each chunk, ask the learner a comprehension question to confirm they understood.
- Guide the learner through all objectives in a natural back-and-forth flow.
- Give encouraging, specific feedback on their answers, then continue to the next concept.
- The entire session should feel complete within roughly 5 minutes of interaction.`;

// Best-effort guardrail. Karibu is not HIPAA compliant and must not handle
// protected health information. Appended to every user-facing system prompt
// so it sits at the end (recency) and overrides anything earlier.
const HIPAA_GUARDRAIL = `\n---\nHIPAA GUARDRAIL (applies at all times, overrides anything above):
Karibu is not HIPAA compliant and must never accept, store, repeat, or reason over protected health information about a specific patient. This includes, but is not limited to:
- patient names, initials, dates of birth, ages, or other identifiers
- room numbers, bed assignments, unit locations
- diagnoses, conditions, symptoms, or clinical observations tied to a specific patient
- medications administered to or prescribed for a specific patient
- care notes, incident reports, or any other detail that could identify an individual patient

PHI means information about a real, identifiable patient. Hypothetical, generic, or educational clinical questions are NOT PHI and MUST be answered normally, even when they mention "a patient" or "the patient". A question with no name, initials, room number, date, or other detail pointing to a real individual is a general clinical question, not PHI.
- Answer normally: "What if the patient has a fever within the first 15 minutes of a blood transfusion?" (generic clinical scenario, no identifiable individual)
- Decline: "My patient in room 12 spiked a fever during her transfusion — what should I chart?" (real, identifiable patient)

If the user's message includes or implies any of the above about a real, identifiable patient:
- Do not answer the question using those details.
- Do not repeat back, summarize, quote, or otherwise reference the patient-specific information — not in this turn and not later in the conversation.
- Respond with a brief redirect along the lines of: "Karibu can't accept or store patient information. For anything about a specific patient, please speak with your charge nurse or on-site clinical staff. I'm happy to help with general facility policies, procedures, or preparation questions."
- If a non-patient-specific version of the question is reasonable to answer (e.g. a general policy or procedure question), offer to help with that instead.`;

// Referral shown when an organization has restrictToKnowledgeBase enabled and the
// assistant would otherwise answer from its own general knowledge. Wording follows the
// precedent set by HIPAA_GUARDRAIL above. Used whenever the org has not authored its own.
const DEFAULT_KNOWLEDGE_REDIRECT = `I can only share your facility's own guidance here. For anything beyond that, please check with your charge nurse or supervisor.`;

/**
 * Prompt block appended for organizations that restrict the assistant to their own
 * knowledge. Enforcement lives in the reportSource tool — this block exists to make the
 * model report honestly so that gate actually fires.
 */
function knowledgeRestrictionDirective(): string {
  return `\n---\nKNOWLEDGE RESTRICTION (active for this organization):
Answer ONLY from [Source Knowledge], [Document Knowledge], or [Karibu Manual]. Never answer from your own general knowledge, even when you are confident and even when the question seems harmless.
- If you cannot answer from those sources, do NOT answer. Call reportSource with "general" and then follow exactly the instruction it returns.
- Report honestly. Never label a general-knowledge answer as "source", "document", or "manual" to work around this rule.
- Greetings, small talk, acknowledgments, clarifying questions back to the user, and describing your own capabilities are still allowed — report those as "conversational" as usual.`;
}

// ─── GET /chat/ml/:microlearningId ─────────────────────────────────────────────

/**
 * GET /chat/ml/:microlearningId
 * Load the existing chat (id + messages) for the current user and a given ML.
 * Returns null chatId and empty messages if no prior conversation exists.
 */
chat.get('/ml/:microlearningId', async (c) => {

  const auth = c.get('auth') as UserAuthContext;
  const microlearningId = c.req.param('microlearningId');

  const [existing] = await db
    .select({ id: chats.id })
    .from(chats)
    .where(and(
      eq(chats.userId, auth.userId),
      eq(chats.microlearningId, microlearningId),
      eq(chats.type, 'microlearning'),
    ))
    .orderBy(chats.updatedAt)
    .limit(1);

  if (!existing) {
    return c.json({ chatId: null, messages: [] });
  }

  const messages = await loadChat(existing.id);

  return c.json({ chatId: existing.id, messages });
});

// ─── POST /chat/ml ─────────────────────────────────────────────────────────────

const mlChatSchema = z.object({
  chatId: z.string().min(1),
  microlearningId: z.string().uuid(),
  messages: z.array(z.object({
    id: z.string(),
    role: z.enum(['user', 'assistant', 'system']),
    parts: z.array(z.record(z.string(), z.unknown())),
  })).min(1),
});

/**
 * POST /chat/ml
 * Streaming chat endpoint for microlearning conversations.
 * - Loads ML context (pattern, topic, subtopics, DNA values)
 * - Provides vector search and completion detection tools
 * - Marks ML as completed when the AI determines all objectives are covered
 */
chat.post('/ml', zValidator('json', mlChatSchema), async (c) => {

  const { chatId, microlearningId } = c.req.valid('json');
  const messages = c.req.valid('json').messages as UIMessage[];
  const auth = c.get('auth') as UserAuthContext;

  // Load the microlearning
  const [ml] = await db
    .select()
    .from(microlearnings)
    .where(and(
      eq(microlearnings.id, microlearningId),
      eq(microlearnings.organizationId, auth.organizationId),
    ))
    .limit(1);

  if (!ml) {
    return c.json({ error: 'Microlearning not found.' }, 404);
  }

  if (ml.status !== 'published' && auth.role !== 'admin') {
    return c.json({ error: 'Microlearning not found.' }, 404);
  }

  trackEvent(c, EVENTS.messageSent, { chat_type: 'microlearning', microlearning_id: microlearningId });

  // Non-admin users: verify the ML is in an assigned sequence
  if (auth.role !== 'admin' && ml.sequenceId) {

    const groupMemberships = await db
      .select({ groupId: userGroupMembers.groupId })
      .from(userGroupMembers)
      .where(eq(userGroupMembers.userId, auth.userId));

    const isAllGroups = await db
      .select({ id: userGroups.id })
      .from(userGroups)
      .where(and(
        eq(userGroups.organizationId, auth.organizationId),
        eq(userGroups.isAll, true),
      ));

    const relevantGroupIds = [
      ...new Set([
        ...groupMemberships.map((m) => m.groupId),
        ...isAllGroups.map((g) => g.id),
      ]),
    ];

    const [assignment] = relevantGroupIds.length > 0
      ? await db
        .select()
        .from(microlearningSequenceAssignments)
        .where(and(
          eq(microlearningSequenceAssignments.sequenceId, ml.sequenceId),
          inArray(microlearningSequenceAssignments.groupId, relevantGroupIds),
        ))
        .limit(1)
      : [null];

    if (!assignment) {
      return c.json({ error: 'Microlearning not found.' }, 404);
    }
  }

  // Load organization name and learner name in parallel
  const [[org], [learner]] = await Promise.all([
    db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, auth.organizationId))
      .limit(1),
    db
      .select({ firstName: users.firstName, lastName: users.lastName, preferredAvatarId: users.preferredAvatarId, language: users.language })
      .from(users)
      .where(eq(users.id, auth.userId))
      .limit(1),
  ]);
  const organizationName = org?.name ?? 'your organization';
  const learnerName = formatLearnerName(learner?.firstName, learner?.lastName);

  // The language the session is conducted in. Mutable so the setLanguage tool
  // can flip it within the same request and the metadata reflects the change.
  let language = resolveLanguage(learner?.language);

  // Resolve the avatar persona for this session (learner preference → org
  // default → built-in fallback). Admins have no learner preference. The
  // persona text is the avatar's localization for the active language.
  const persona = await resolveSessionAvatar(
    auth.organizationId,
    auth.role !== 'admin' ? learner?.preferredAvatarId ?? null : null,
    language,
  );

  // Load conversation pattern
  let patternPrompt = DEFAULT_ML_SYSTEM_PROMPT;
  let multipleChoiceEnabled = false;
  let responseLength: string | null = null;
  if (ml.patternId) {
    const [pattern] = await db
      .select({
        prompt: conversationPatterns.prompt,
        multipleChoiceEnabled: conversationPatterns.multipleChoiceEnabled,
        responseLength: conversationPatterns.responseLength,
      })
      .from(conversationPatterns)
      .where(eq(conversationPatterns.id, ml.patternId))
      .limit(1);
    if (pattern) {

      patternPrompt = pattern.prompt;
      multipleChoiceEnabled = pattern.multipleChoiceEnabled;
      responseLength = pattern.responseLength;
    }
  }

  // Load topics, subtopics and DNA values
  let mlTopics: Array<{ name: string; description: string }> = [];
  let relevantSubtopics: Array<{ name: string; description: string }> = [];
  let dnaKnowledge: string[] = [];

  const mlTopicIds = ml.topicIds ?? [];

  if (mlTopicIds.length > 0) {

    const topicRows = await db
      .select()
      .from(dnaTopics)
      .where(inArray(dnaTopics.id, mlTopicIds));

    if (topicRows.length > 0) {
      mlTopics = topicRows.map((t) => ({ name: t.name, description: t.description }));

      // Get subtopics: if ML specifies subtopicIds, use those; otherwise use all in selected topics
      const allSubtopics = await db
        .select()
        .from(dnaSubtopics)
        .where(inArray(dnaSubtopics.topicId, mlTopicIds));

      const subtopicsToUse = (ml.subtopicIds && ml.subtopicIds.length > 0)
        ? allSubtopics.filter((s) => ml.subtopicIds!.includes(s.id))
        : allSubtopics;

      relevantSubtopics = subtopicsToUse.map((s) => ({ name: s.name, description: s.description }));

      // Load approved DNA values for those subtopics
      const subtopicIds = subtopicsToUse.map((s) => s.id);
      if (subtopicIds.length > 0) {
        const values = await db
          .select({ content: dnaValues.content })
          .from(dnaValues)
          .where(and(
            inArray(dnaValues.subtopicId, subtopicIds),
            eq(dnaValues.approval, 'approved'),
          ));
        dnaKnowledge = values.map((v) => v.content);
      }
    }
  }

  // Get or create progress record
  const [existingProgress] = await db
    .select()
    .from(microlearningProgress)
    .where(and(
      eq(microlearningProgress.userId, auth.userId),
      eq(microlearningProgress.microlearningId, microlearningId),
    ))
    .limit(1);

  const isCompleted = existingProgress?.status === 'completed';

  if (!existingProgress) {
    await db
      .insert(microlearningProgress)
      .values({
        userId: auth.userId,
        microlearningId,
        status: 'active',
        openedAt: new Date(),
      })
      .onConflictDoNothing();
  }

  // Build system prompt
  const systemPrompt = buildMLSystemPrompt(
    patternPrompt,
    mlTopics,
    relevantSubtopics,
    dnaKnowledge,
    isCompleted,
    organizationName,
    learnerName,
    responseLength,
    persona,
    language,
  );

  // Track whether the ML was completed during this request
  let justCompleted = false;
  // Track an in-request language change so we can signal the client.
  let languageChanged: LanguageCode | null = null;
  const setLanguageTool = makeSetLanguageTool(auth.userId, (next) => {
    language = next;
    languageChanged = next;
  });

  const searchKnowledgeTool = {
    description: 'Search the organizational knowledge base for additional context relevant to the learner\'s questions.',
    inputSchema: z.object({
      query: z.string().describe('Search query to find relevant organizational knowledge'),
    }),
    execute: async ({ query }: { query: string }) => {
      try {
        const results = await queryDocuments(query, auth.organizationId, 5);
        const docs = results.documents.filter(Boolean) as string[];
        if (docs.length === 0) return 'No additional relevant information found.';
        return docs.join('\n\n');
      } catch (err) {
        logger.warn({ err }, 'Vector search failed during ML chat.');
        return 'Knowledge search unavailable.';
      }
    },
  };

  const offerOptionsTool = {
    description: 'Attach 2-4 short multiple-choice options to the current question. Every option MUST be a direct, grammatically-matching answer to the exact question being asked ("When..." → times, "Why..." → reasons, "Which step..." → steps), with EXACTLY ONE option unambiguously correct and the rest plausible distractors drawn from real misconceptions. Options must be mutually exclusive and share parallel structure and similar length. Options are shown as clickable chips below the message; the learner can still type a free-form answer.',
    inputSchema: z.object({
      options: z
        .array(z.string().min(1).max(80))
        .min(2)
        .max(4)
        .describe('Between 2 and 4 short option strings the learner can pick from.'),
    }),
    execute: async () => 'ok',
  };

  const tools: ToolSet = isCompleted
    ? {
        searchKnowledge: searchKnowledgeTool,
        setLanguage: setLanguageTool,
        ...(multipleChoiceEnabled ? { offerOptions: offerOptionsTool } : {}),
      }
    : {
        searchKnowledge: searchKnowledgeTool,
        setLanguage: setLanguageTool,
        ...(multipleChoiceEnabled ? { offerOptions: offerOptionsTool } : {}),
        markLearningComplete: {
          description: 'Call this tool when ALL learning objectives have been covered and the learner demonstrates sufficient understanding. This marks the microlearning as completed.',
          inputSchema: z.object({
            summary: z.string().describe('Brief summary of what the learner covered and demonstrated understanding of'),
          }),
          execute: async ({ summary }: { summary: string }) => {
            try {
              await db
                .update(microlearningProgress)
                .set({ status: 'completed', completedAt: new Date() })
                .where(and(
                  eq(microlearningProgress.userId, auth.userId),
                  eq(microlearningProgress.microlearningId, microlearningId),
                ));

              justCompleted = true;
              logger.debug({ userId: auth.userId, microlearningId }, 'Microlearning marked as completed.');

              trackEvent(c, EVENTS.microlearningCompleted, { microlearning_id: microlearningId, completion_path: 'tool' });

              // Fire-and-forget per-ML outbound completion webhook (used e.g. by
              // the Teambridge integration to mark the learner's verification on
              // their facility shifts). Failures handled inside notifyMlCompletion.
              if (ml.completionWebhookUrl) {
                void notifyMlCompletion({
                  url: ml.completionWebhookUrl,
                  karibuUserId: auth.userId,
                  organizationId: auth.organizationId,
                  microlearningId,
                  completedAt: new Date(),
                });
              }

              return `Great work! ${summary}`;
            } catch (err) {
              logger.error({ err, userId: auth.userId, microlearningId }, 'Failed to mark ML as completed.');
              return 'Unable to record completion at this time.';
            }
          },
        },
      };

  const result = streamText({
    model: openai(env.OPENAI_CHAT_MODEL),
    system: systemPrompt,
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(3),
    tools,
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    generateMessageId: createIdGenerator({ prefix: 'msg', size: 16 }),
    messageMetadata: ({ part }) => {
      if (part.type === 'finish' && (justCompleted || languageChanged)) {
        return {
          ...(justCompleted ? { mlCompleted: true } : {}),
          ...(languageChanged ? { languageChanged } : {}),
        };
      }
    },
    onFinish: ({ messages: updatedMessages }) => {
      saveChat({
        chatId,
        messages: updatedMessages,
        userId: auth.userId,
        organizationId: auth.organizationId,
        type: 'microlearning',
        microlearningId,
      }).catch((err) => {
        logger.error({ err, chatId }, 'Failed to persist ML chat after stream finish.');
      });

      // Safety net: the main chat model occasionally writes a closing message
      // without calling markLearningComplete in the same step (so the ML only
      // gets marked complete after the learner sends another message). Run a
      // cheap classifier on the finished conversation; if it agrees the
      // session is complete, mark it now so completion happens on the same
      // turn instead of the next one.
      if (!justCompleted && !isCompleted) {
        void (async () => {
          try {
            const shouldComplete = await isMicrolearningComplete({
              messages: updatedMessages,
              topics: mlTopics,
              subtopics: relevantSubtopics,
            });
            if (!shouldComplete) return;

            const result = await db
              .update(microlearningProgress)
              .set({ status: 'completed', completedAt: new Date() })
              .where(and(
                eq(microlearningProgress.userId, auth.userId),
                eq(microlearningProgress.microlearningId, microlearningId),
                eq(microlearningProgress.status, 'active'),
              ))
              .returning({ id: microlearningProgress.id });

            if (result.length === 0) return;

            logger.info(
              { userId: auth.userId, microlearningId },
              'Microlearning marked as completed by classifier safety net.',
            );

            trackEvent(c, EVENTS.microlearningCompleted, { microlearning_id: microlearningId, completion_path: 'classifier' });

            if (ml.completionWebhookUrl) {
              void notifyMlCompletion({
                url: ml.completionWebhookUrl,
                karibuUserId: auth.userId,
                organizationId: auth.organizationId,
                microlearningId,
                completedAt: new Date(),
              });
            }
          } catch (err) {
            logger.error({ err, userId: auth.userId, microlearningId }, 'Classifier safety net failed.');
          }
        })();
      }
    },
  });
});

// ─── POST /chat/assistant ──────────────────────────────────────────────────────

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
 * Search order: approved source values → vector DB → general knowledge (LLM).
 * Tracks the data source and surfaces it via message metadata.
 */
chat.post('/assistant', zValidator('json', assistantChatSchema), async (c) => {

  const { chatId } = c.req.valid('json');
  const messages = c.req.valid('json').messages as UIMessage[];
  const auth = c.get('auth') as UserAuthContext;

  trackEvent(c, EVENTS.messageSent, { chat_type: 'discussion' });

  const [[assistantOrg], [assistantLearner]] = await Promise.all([
    db
      .select({
        name: organizations.name,
        restrictToKnowledgeBase: organizations.restrictToKnowledgeBase,
        knowledgeRedirectMessage: organizations.knowledgeRedirectMessage,
      })
      .from(organizations)
      .where(eq(organizations.id, auth.organizationId))
      .limit(1),
    db
      .select({ firstName: users.firstName, lastName: users.lastName, language: users.language, preferredAvatarId: users.preferredAvatarId })
      .from(users)
      .where(eq(users.id, auth.userId))
      .limit(1),
  ]);
  const assistantOrgName = assistantOrg?.name ?? 'your organization';

  // Org-level guardrail: block answers drawn from the model's own general knowledge and
  // refer the learner to a human instead. Enforced in the reportSource tool below.
  const restrictGeneral = assistantOrg?.restrictToKnowledgeBase ?? false;
  const knowledgeRedirect =
    assistantOrg?.knowledgeRedirectMessage?.trim() || DEFAULT_KNOWLEDGE_REDIRECT;
  const assistantLearnerName = formatLearnerName(assistantLearner?.firstName, assistantLearner?.lastName);

  // Language the assistant replies in. Mutable so the setLanguage tool can flip it.
  let assistantLanguage = resolveLanguage(assistantLearner?.language);
  let assistantLanguageChanged: LanguageCode | null = null;
  const assistantSetLanguageTool = makeSetLanguageTool(auth.userId, (next) => {
    assistantLanguage = next;
    assistantLanguageChanged = next;
  });

  // Persona layered onto the assistant's tone (voice + photo come from the
  // frontend). Same precedence as ML chat: learner preference → org default →
  // built-in fallback. It shapes tone only and must not override grounding.
  const assistantPersona = await resolveSessionAvatar(
    auth.organizationId,
    auth.role !== 'admin' ? assistantLearner?.preferredAvatarId ?? null : null,
    assistantLanguage,
  );
  const assistantPersonaLine = `\n\nYOUR PERSONA: You are ${assistantPersona.name}. Embody this character's tone, warmth, and word choice: ${assistantPersona.description}\nThis shapes only your tone — it must never override the knowledge-search rules, the reportSource requirement, or factual grounding above.`;

  const learnerLine = assistantLearnerName
    ? `\n\nLEARNER: ${assistantLearnerName}\nAddress the learner by their first name when it feels natural.`
    : '';

  const assistantSystemPrompt = `You are a helpful assistant for the organization "${assistantOrgName}".${learnerLine} Answer questions clearly and concisely.

You have two knowledge tools:
- searchKnowledge — searches this organization's own knowledge base. Call it before answering whenever the user is asking for information about their organization.
- searchKaribuManual — searches the Karibu product manual. Call it whenever the user asks how to use Karibu, what a Karibu feature does, or how the platform works.

searchKnowledge returns results in labeled sections:
- [Source Knowledge] — curated, verified organizational knowledge. Prioritize this.
- [Document Knowledge] — relevant excerpts from uploaded documents. Use when source knowledge is insufficient.
- If neither section appears, no organizational knowledge was found.

searchKaribuManual returns results in a [Karibu Manual] section, or a not-found message if nothing relevant exists.

IMPORTANT: Never include the section labels [Source Knowledge], [Document Knowledge], or [Karibu Manual] in your response text. They are internal markers only.

You MUST call reportSource before writing your response, describing what your response will be based on:
- "source" if your response will convey information from [Source Knowledge]
- "document" if your response will convey information from [Document Knowledge]
- "manual" if your response will convey information from the [Karibu Manual]
- "general" if your response will convey information from your own general knowledge (search results were irrelevant or you didn't search)
- "conversational" if your response does not convey factual information from a knowledge source — e.g. greetings, thanks, small talk, acknowledgments, clarifying questions back to the user, or describing your own capabilities and how you can help

If the learner asks to switch to a language you support, call setLanguage with that language and then continue in it. If they ask for a language you don't support, tell them it isn't available and keep going in the current language.
${assistantPersonaLine}
${languageDirective(assistantLanguage)}
${restrictGeneral ? knowledgeRestrictionDirective() : ''}
${HIPAA_GUARDRAIL}`;

  // Track the best knowledge source used during this response:
  // null = tool not called, 'source' = approved values, 'document' = vector DB,
  // 'manual' = Karibu manual, 'general' = LLM only,
  // 'conversational' = non-informational reply (no badge shown)
  let dataSource: 'source' | 'document' | 'manual' | 'general' | 'conversational' | null = null;
  let searchWasCalled = false;
  // Set when the knowledge restriction turned a 'general' answer into a referral.
  let blockedByRestriction = false;

  const result = streamText({
    model: openai(env.OPENAI_CHAT_MODEL),
    system: assistantSystemPrompt,
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(3),
    tools: {
      setLanguage: assistantSetLanguageTool,
      searchKnowledge: {
        description: 'Search the organizational knowledge base for information relevant to the user\'s question. Always call this before answering.',
        inputSchema: z.object({
          query: z.string().describe('Search query to find relevant organizational knowledge'),
        }),
        execute: async ({ query }) => {
          searchWasCalled = true;
          const sections: string[] = [];

          // Phase 1: Fetch approved source values for the organization
          try {
            const approvedValues = await db
              .select({
                content: dnaValues.content,
                topicName: dnaTopics.name,
                subtopicName: dnaSubtopics.name,
              })
              .from(dnaValues)
              .innerJoin(dnaSubtopics, eq(dnaValues.subtopicId, dnaSubtopics.id))
              .innerJoin(dnaTopics, eq(dnaSubtopics.topicId, dnaTopics.id))
              .where(and(
                eq(dnaTopics.organizationId, auth.organizationId),
                eq(dnaValues.approval, 'approved'),
              ));

            if (approvedValues.length > 0) {
              const lines = approvedValues.map((v) => `- [${v.topicName} > ${v.subtopicName}] ${v.content}`);
              sections.push(`[Source Knowledge]\n${lines.join('\n')}`);
            }
          } catch (err) {
            logger.warn({ err }, 'Source values query failed during assistant chat.');
          }

          // Phase 2: Search vector DB for document chunks
          try {
            const results = await queryDocuments(query, auth.organizationId, 5);
            const docs = results.documents.filter(Boolean) as string[];
            if (docs.length > 0) {
              sections.push(`[Document Knowledge]\n${docs.join('\n\n')}`);
            }
          } catch (err) {
            logger.warn({ err }, 'Vector search failed during assistant chat.');
          }

          if (sections.length === 0) {
            return 'No organizational knowledge found for this query.';
          }

          return sections.join('\n\n---\n\n');
        },
      },
      searchKaribuManual: {
        description: 'Search the Karibu product manual (the Karibu Knowledge Base) for information about how to use Karibu, its features, and how the platform works. Call this whenever the user asks about using Karibu itself.',
        inputSchema: z.object({
          query: z.string().describe('Search query to find relevant Karibu manual content'),
        }),
        execute: async ({ query }) => {
          searchWasCalled = true;
          try {
            const results = await queryManual(query, 5);
            const docs = results.documents.filter(Boolean) as string[];
            if (docs.length === 0) {
              return 'No Karibu manual information found for this query.';
            }
            return `[Karibu Manual]\n${docs.join('\n\n')}`;
          } catch (err) {
            logger.warn({ err }, 'Karibu manual search failed during assistant chat.');
            return 'Karibu manual search unavailable.';
          }
        },
      },
      reportSource: {
        description: 'Report what your response will be based on. Call this before writing your response.',
        inputSchema: z.object({
          source: z.enum(['source', 'document', 'manual', 'general', 'conversational']).describe(
            '"source" if response conveys Source Knowledge, "document" if response conveys Document Knowledge, "manual" if response conveys information from the Karibu Manual, "general" if response conveys factual information from your own general knowledge, "conversational" if response does not convey factual information from a knowledge source (greetings, small talk, acknowledgments, clarifying questions, or describing your own capabilities)',
          ),
        }),
        execute: async ({ source }: { source: 'source' | 'document' | 'manual' | 'general' | 'conversational' }) => {
          dataSource = source;

          // The model must call this before writing its response, so intercepting here
          // blocks the answer before any ungrounded content has been generated.
          if (source === 'general' && restrictGeneral) {
            blockedByRestriction = true;
            logger.debug(
              { organizationId: auth.organizationId, chatId },
              'General-knowledge answer blocked by org knowledge restriction.',
            );
            return `BLOCKED: This organization does not permit answering from general knowledge. `
              + `Do not answer the user's question and do not include any general-knowledge information, `
              + `hints, or partial answers. Reply with only the following message, translated into the `
              + `learner's language if it differs, and nothing else:\n\n${knowledgeRedirect}`;
          }

          return 'Recorded.';
        },
      },
    },
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    generateMessageId: createIdGenerator({ prefix: 'msg', size: 16 }),
    messageMetadata: ({ part }) => {
      if (part.type === 'finish') {
        const meta: Record<string, unknown> = {};
        if (blockedByRestriction) {
          // Not a general-knowledge answer — a referral. Labelling it "General Knowledge"
          // in the UI would tell the learner the opposite of what happened.
          meta.dataSource = 'restricted';
        } else if (dataSource ?? (searchWasCalled ? 'general' : null)) {
          meta.dataSource = dataSource ?? 'general';
        }
        if (assistantLanguageChanged) {
          meta.languageChanged = assistantLanguageChanged;
        }
        if (Object.keys(meta).length > 0) return meta;
      }
    },
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

// ─── POST /chat/tts ────────────────────────────────────────────────────────────

const ttsSchema = z.object({
  text: z.string().min(1).max(4000),
  voiceId: z.string().min(1).optional(),
});

const DEFAULT_VOICE_ID = process.env.DEFAULT_VOICE_ID ?? 'aura-2-asteria-en'; // Deepgram "Asteria"

/**
 * POST /chat/tts
 * Convert text to speech using Deepgram and stream back MP3 audio.
 * For Deepgram, the voiceId is the model name (e.g. "aura-2-asteria-en").
 */
chat.post('/tts', zValidator('json', ttsSchema), async (c) => {

  if (!env.DEEPGRAM_API_KEY) {
    return c.json({ error: 'TTS is not configured on this server.' }, 400);
  }

  const { text, voiceId = DEFAULT_VOICE_ID } = c.req.valid('json');

  try {

    const result = await generateSpeech({
      model: deepgram.speech(voiceId),
      text,
    });

    return new Response(result.audio.uint8Array.buffer as ArrayBuffer, {
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

// ─── POST /chat/transcribe ─────────────────────────────────────────────────────

/**
 * POST /chat/transcribe
 * Transcribe an audio file to text using Deepgram nova-3.
 * Accepts multipart/form-data with an `audio` field.
 */
chat.post('/transcribe', async (c) => {

  if (!env.DEEPGRAM_API_KEY) {
    return c.json({ error: 'Transcription is not configured on this server.' }, 400);
  }

  try {

    const body = await c.req.parseBody();
    const file = body['audio'] as File | undefined;

    if (!file) {
      return c.json({ error: 'No audio file provided.' }, 400);
    }

    const result = await transcribe({
      model: deepgram.transcription('nova-3'),
      audio: new Uint8Array(await file.arrayBuffer()),
    });

    return c.json({ text: result.text });

  } catch (error) {

    if (error instanceof Error && error.name === 'AI_NoTranscriptGeneratedError') {

      logger.debug('Transcription returned empty — silence or no speech detected.');
      
      return c.json({ text: '' });
    }

    logger.error({ error }, 'Transcription failed.');

    return c.json({ error: 'Failed to transcribe audio.' }, 500);
  }
});

export default chat;
