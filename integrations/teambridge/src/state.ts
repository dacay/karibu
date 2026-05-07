// Postgres-backed dedup + shift snapshot diffing.
// Tables live in the `integrations` schema; see src/db/schema.ts.

import { eq, lt } from "drizzle-orm";
import { db } from "./db/client.js";
import { teambridgeEvents, teambridgeShiftSnapshots } from "./db/schema.js";

export interface EventRecord {
  eventId: string;
  eventType: string;
  accountId: string;
  recordId: string;
  actorUserId?: string | null;
  actorName?: string | null;
}

// Atomically claims the event_id. Returns true if the event was already seen.
export async function isDuplicateEvent(event: EventRecord): Promise<boolean> {
  const inserted = await db
    .insert(teambridgeEvents)
    .values({
      eventId: event.eventId,
      eventType: event.eventType,
      accountId: event.accountId,
      recordId: event.recordId,
      actorUserId: event.actorUserId ?? null,
      actorName: event.actorName ?? null,
    })
    .onConflictDoNothing({ target: teambridgeEvents.eventId })
    .returning({ eventId: teambridgeEvents.eventId });

  return inserted.length === 0;
}

export interface ShiftDiff {
  added: Record<string, unknown>;
  removed: Record<string, unknown>;
  changed: Record<string, { from: unknown; to: unknown }>;
}

// Locks the existing snapshot row (if any), upserts the new fields, returns the
// diff against what was there before. Returns null on first sighting.
// FOR UPDATE serializes concurrent updates of the same record_id so two webhooks
// arriving back-to-back for the same shift don't race past each other.
export async function diffAndUpdateShift(
  recordId: string,
  next: unknown,
): Promise<ShiftDiff | null> {
  return db.transaction(async (tx) => {
    const [prev] = await tx
      .select({ fields: teambridgeShiftSnapshots.fields })
      .from(teambridgeShiftSnapshots)
      .where(eq(teambridgeShiftSnapshots.recordId, recordId))
      .for("update");

    await tx
      .insert(teambridgeShiftSnapshots)
      .values({ recordId, fields: next as object })
      .onConflictDoUpdate({
        target: teambridgeShiftSnapshots.recordId,
        set: { fields: next as object, updatedAt: new Date() },
      });

    if (!prev) return null;
    return shallowDiff(prev.fields, next);
  });
}

// Periodic cleanup of old dedup rows. Safe to run any time — the only consumer
// of this table is `isDuplicateEvent`, and dedup only needs a window long enough
// to cover Teambridge retries (minutes). Anything older is incidental audit.
export async function cleanupOldEvents(retentionDays: number): Promise<void> {
  if (retentionDays <= 0) return;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  await db.delete(teambridgeEvents).where(lt(teambridgeEvents.receivedAt, cutoff));
}

function shallowDiff(a: unknown, b: unknown): ShiftDiff {
  const out: ShiftDiff = { added: {}, removed: {}, changed: {} };
  const ao = (a ?? {}) as Record<string, unknown>;
  const bo = (b ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    const av = ao[k];
    const bv = bo[k];
    if (!(k in ao)) out.added[k] = bv;
    else if (!(k in bo)) out.removed[k] = av;
    else if (JSON.stringify(av) !== JSON.stringify(bv)) {
      out.changed[k] = { from: av, to: bv };
    }
  }
  return out;
}
