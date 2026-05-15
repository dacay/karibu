import { generateObject, convertToModelMessages, type UIMessage } from 'ai';
import { z } from 'zod';
import { openai } from '../ai/mastra.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const log = logger.child({ module: 'completion-classifier' });

interface ClassifyArgs {
  messages: UIMessage[];
  topics: Array<{ name: string; description: string }>;
  subtopics: Array<{ name: string; description: string }>;
}

const SCHEMA = z.object({
  completed: z
    .boolean()
    .describe('true if ALL objectives were covered, the learner showed understanding, and the instructor delivered a clear closing/wrap-up; otherwise false.'),
});

/**
 * Safety-net classifier for microlearning completion.
 *
 * Runs after the chat stream finishes. The main chat model is supposed to call
 * the `markLearningComplete` tool in the same response as its closing remarks,
 * but occasionally emits the closing text and stops without invoking the tool.
 * This classifier inspects the finished conversation and returns whether the
 * session should be marked complete, so the caller can update progress without
 * waiting for the learner's next message.
 *
 * Returns false on any error — completion stays off rather than risking a false
 * positive.
 */
export async function isMicrolearningComplete(args: ClassifyArgs): Promise<boolean> {

  const topicsBlock = args.topics.length > 0
    ? args.topics.map((t) => `- ${t.name}${t.description ? `: ${t.description}` : ''}`).join('\n')
    : '(none specified)';

  const objectivesBlock = args.subtopics.length > 0
    ? args.subtopics.map((s, i) => `${i + 1}. ${s.name}: ${s.description}`).join('\n')
    : '(none specified)';

  const system = `You are a strict completion classifier for a microlearning session.

In the conversation that follows, the "assistant" role is the instructor and the "user" role is the learner. (The first user message "__start__" is a system trigger, not real input.)

Microlearning topics:
${topicsBlock}

Learning objectives the instructor must cover:
${objectivesBlock}

Decide whether ALL of the following are true:
1. Every learning objective above has been substantively covered in the conversation.
2. The learner has demonstrated understanding (answered comprehension questions, engaged with the material).
3. The instructor has delivered a closing/wrap-up message that signals the lesson is over (e.g. "great work", "that wraps things up", "you've completed this session", congratulations, summary of what was learned).

Be conservative — return completed=true only when all three conditions clearly hold. If the last assistant message is mid-lesson, asking a new question, or introducing a new concept, return completed=false.`;

  try {
    const { object } = await generateObject({
      model: openai(env.OPENAI_CLASSIFIER_MODEL),
      schema: SCHEMA,
      system,
      messages: await convertToModelMessages(args.messages),
    });
    return object.completed;
  } catch (err) {
    log.warn({ err }, 'completion classifier failed; defaulting to in-progress');
    return false;
  }
}
