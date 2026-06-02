import { zValidator as baseZValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import type { ZodType } from 'zod';

/**
 * Flatten a ZodError's issues into a single human-readable message.
 * Each issue is rendered as "<path>: <message>" (path omitted when empty),
 * joined by "; " so single-field failures read cleanly and multi-field
 * failures stay legible.
 */
function formatZodIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

/**
 * Drop-in replacement for `@hono/zod-validator`'s `zValidator` that, on
 * validation failure, returns a 400 with a flat, readable `message` instead of
 * the raw ZodError object. This lets clients surface the schema's own messages
 * rather than rendering "[object Object]".
 */
export function zValidator<T extends ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T
) {
  return baseZValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json({ message: formatZodIssues(result.error.issues) }, 400);
    }
  });
}
