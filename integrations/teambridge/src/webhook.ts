import type { Context } from "hono";
import { and, eq } from "drizzle-orm";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { verifyWebhook } from "./signature.js";
import { isDuplicateEvent, diffAndUpdateShift } from "./state.js";
import {
  getShift,
  extractAssigneeIds,
  setShiftField,
  deleteRecords,
  deactivateTaskTemplate,
  deleteTaskTemplate,
  type ShiftRecord,
} from "./teambridge.js";
import { getFacility } from "./facilities.js";
import { getSchema, fieldName } from "./schema.js";
import { onboardNurseToFacility } from "./onboarding.js";
import { db } from "./db/client.js";
import {
  teambridgeNurseFacilityInvites,
  teambridgeNurseFacilityVerifications,
} from "./db/schema.js";

const log = logger.child({ module: "webhook" });

const HANDLED_EVENT_TYPES = new Set(["shift_created", "shift_updated", "shift_deleted"]);

interface WebhookEvent {
  version: string;
  event_type: string;
  event_id: string;
  timestamp: string;
  account_id: string;
  data: {
    action: string;
    collection_id: string;
    record_id: string;
    actor?: { user_id: string; name: string };
  };
}

export async function handleWebhook(c: Context): Promise<Response> {
  const rawBody = await c.req.text();

  if (config.teambridge.verifyWebhookSignature) {
    const verification = verifyWebhook(
      rawBody,
      c.req.header("x-webhook-signature"),
      c.req.header("x-webhook-timestamp"),
      config.teambridge.webhookSecret,
    );
    if (!verification.ok) {
      log.warn({ reason: verification.reason }, "webhook rejected: signature verification failed");
      return c.json({ error: verification.reason }, 400);
    }
  } else {
    log.warn("webhook signature verification is DISABLED (VERIFY_WEBHOOK_SIGNATURE=false)");
  }

  let event: WebhookEvent;
  try {
    event = JSON.parse(rawBody) as WebhookEvent;
  } catch {
    log.warn("webhook rejected: invalid JSON body");
    return c.json({ error: "invalid JSON" }, 400);
  }

  const baseCtx = {
    eventId: event.event_id,
    eventType: event.event_type,
    recordId: event.data?.record_id,
  };

  if (!HANDLED_EVENT_TYPES.has(event.event_type)) {
    log.info(baseCtx, "ignored: event_type not subscribed");
    return c.json({ ok: true, ignored: true });
  }

  log.info(
    { ...baseCtx, actor: event.data.actor?.name },
    "accepted: shift event queued for processing",
  );

  // Process asynchronously so we return 200 within 5s. Errors are logged, not retried —
  // Teambridge only retries on non-2xx. Dedup lives inside each processor so events
  // for untracked shifts never write a row.
  const processor =
    event.event_type === "shift_deleted" ? processShiftDeleted : processShiftUpdate;
  processor(event).catch((err) =>
    log.error({ ...baseCtx, err }, `${event.event_type} processing failed`),
  );

  return c.json({ ok: true });
}

async function processShiftUpdate(event: WebhookEvent): Promise<void> {
  const { record_id, actor } = event.data;
  const ctx = { eventId: event.event_id, recordId: record_id };

  const shift = await getShift(record_id);
  const facilityId = extractFacilityId(shift);
  const facility = facilityId ? getFacility(facilityId) : undefined;

  if (!facility) {
    log.info(
      { ...ctx, facilityId },
      facilityId
        ? "ignored: shift's facility is not in tracked facilities map"
        : "ignored: shift has no facility/location field",
    );
    return;
  }

  const duplicate = await isDuplicateEvent({
    eventId: event.event_id,
    eventType: event.event_type,
    accountId: event.account_id,
    recordId: record_id,
    actorUserId: event.data.actor?.user_id ?? null,
    actorName: event.data.actor?.name ?? null,
  });
  if (duplicate) {
    log.info(ctx, "ignored: duplicate event_id");
    return;
  }

  const diff = await diffAndUpdateShift(record_id, shift.fields);

  log.info(
    {
      ...ctx,
      actor: actor?.name,
      facility: { id: facilityId, name: facility.name, karibu_base_url: facility.karibuBaseUrl },
      changeSummary: diff
        ? {
            changed: Object.keys(diff.changed).map(fieldName),
            added: Object.keys(diff.added).map(fieldName),
            removed: Object.keys(diff.removed).map(fieldName),
          }
        : null,
      firstSighting: diff === null,
    },
    "processed: shift_updated",
  );

  if (diff && Object.keys(diff.changed).length) {
    const changedNamed = Object.fromEntries(
      Object.entries(diff.changed).map(([id, v]) => [fieldName(id), v]),
    );
    log.debug({ ...ctx, changed: changedNamed }, "shift field-level diff");
  }
  log.debug({ ...ctx, shift: shift.fields }, "full shift payload");

  // Onboard each assignee to Karibu the first time we see them paired with this
  // facility. PK on (nurse_id, facility_id) makes this a no-op for already-onboarded
  // pairs. Failures are logged but don't fail the whole shift_updated processing.
  const assigneeIds = extractAssigneeIds(shift);
  for (const nurseId of assigneeIds) {
    try {
      await onboardNurseToFacility(facility, facilityId!, nurseId, event.account_id, record_id);
    } catch {
      // already logged inside onboardNurseToFacility
    }
  }

  // Auto-populate "Karibu Completed" on this shift for any assignee already
  // verified at this facility. The verifications row is created when Karibu
  // fires the ML-completed webhook back to us. Idempotent — Teambridge accepts
  // re-writes of the same value as a no-op.
  const { karibuCompletedFieldId, karibuCompletedValue } = getSchema();
  for (const nurseId of assigneeIds) {
    const verified = await db
      .select({ nurseId: teambridgeNurseFacilityVerifications.nurseId })
      .from(teambridgeNurseFacilityVerifications)
      .where(
        and(
          eq(teambridgeNurseFacilityVerifications.nurseId, nurseId),
          eq(teambridgeNurseFacilityVerifications.facilityId, facilityId!),
        ),
      )
      .limit(1);
    if (verified.length === 0) continue;
    try {
      await setShiftField(record_id, karibuCompletedFieldId, karibuCompletedValue);
      log.info({ ...ctx, nurseId }, "auto-applied Karibu Completed on shift");
    } catch (err) {
      log.error({ ...ctx, nurseId, err }, "auto-apply Karibu Completed failed");
    }
  }
}

function extractFacilityId(shift: ShiftRecord): string | null {
  const v = shift.fields[getSchema().locationFieldId];
  if (typeof v === "string") return v;
  return null;
}

async function processShiftDeleted(event: WebhookEvent): Promise<void> {
  const { record_id } = event.data;
  const ctx = { eventId: event.event_id, recordId: record_id };

  const duplicate = await isDuplicateEvent({
    eventId: event.event_id,
    eventType: event.event_type,
    accountId: event.account_id,
    recordId: record_id,
    actorUserId: event.data.actor?.user_id ?? null,
    actorName: event.data.actor?.name ?? null,
  });
  if (duplicate) {
    log.info(ctx, "ignored: duplicate event_id");
    return;
  }

  // We only act when the deleted shift is the one we used to trigger onboarding.
  // Other shift deletions don't touch any of our state.
  const [invite] = await db
    .select({
      nurseId: teambridgeNurseFacilityInvites.nurseId,
      facilityId: teambridgeNurseFacilityInvites.facilityId,
      taskRecordId: teambridgeNurseFacilityInvites.taskRecordId,
      taskTemplateId: teambridgeNurseFacilityInvites.taskTemplateId,
      accountId: teambridgeNurseFacilityInvites.accountId,
    })
    .from(teambridgeNurseFacilityInvites)
    .where(eq(teambridgeNurseFacilityInvites.firstShiftId, record_id))
    .limit(1);

  if (!invite) {
    log.info(ctx, "ignored: deleted shift not tracked as a first shift");
    return;
  }

  const inviteCtx = {
    ...ctx,
    nurseId: invite.nurseId,
    facilityId: invite.facilityId,
  };

  const { tasksCollectionId } = getSchema();

  // Best-effort cleanup: each step logs on failure but does not abort the rest.
  // Row deletion is intentionally last — a partial Teambridge-side failure leaves
  // dangling artifacts that can be cleaned up manually, but the row removal still
  // unblocks future re-onboarding for this (nurse, facility) pair.
  if (invite.taskRecordId && invite.accountId) {
    try {
      await deleteRecords({
        accountId: invite.accountId,
        collectionId: tasksCollectionId,
        recordIds: [invite.taskRecordId],
      });
      log.info(
        { ...inviteCtx, taskRecordId: invite.taskRecordId },
        "deleted task instance for deleted shift",
      );
    } catch (err) {
      log.error(
        { ...inviteCtx, taskRecordId: invite.taskRecordId, err },
        "failed to delete task instance",
      );
    }
  }

  if (invite.taskTemplateId) {
    try {
      await deactivateTaskTemplate(invite.taskTemplateId);
      log.info(
        { ...inviteCtx, taskTemplateId: invite.taskTemplateId },
        "deactivated task template",
      );
    } catch (err) {
      log.error(
        { ...inviteCtx, taskTemplateId: invite.taskTemplateId, err },
        "failed to deactivate task template",
      );
    }

    try {
      await deleteTaskTemplate(invite.taskTemplateId);
      log.info(
        { ...inviteCtx, taskTemplateId: invite.taskTemplateId },
        "deleted task template",
      );
    } catch (err) {
      log.error(
        { ...inviteCtx, taskTemplateId: invite.taskTemplateId, err },
        "failed to delete task template",
      );
    }
  }

  await db
    .delete(teambridgeNurseFacilityInvites)
    .where(
      and(
        eq(teambridgeNurseFacilityInvites.nurseId, invite.nurseId),
        eq(teambridgeNurseFacilityInvites.facilityId, invite.facilityId),
      ),
    );
  log.info(inviteCtx, "deleted invite row — pair will re-onboard on next shift");
}
