import type { Context } from "hono";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { verifyWebhook } from "./signature.js";
import { isDuplicateEvent, diffAndUpdateShift } from "./state.js";
import { getShift, extractAssigneeIds, type ShiftRecord } from "./teambridge.js";
import { getFacility } from "./facilities.js";
import { getSchema, fieldName } from "./schema.js";
import { onboardNurseToFacility } from "./onboarding.js";

const log = logger.child({ module: "webhook" });

const HANDLED_EVENT_TYPES = new Set(["shift_created", "shift_updated"]);

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
  // Teambridge only retries on non-2xx. Dedup lives inside processShiftUpdate so
  // events for untracked facilities never write a row.
  processShiftUpdate(event).catch((err) =>
    log.error({ ...baseCtx, err }, "shift_updated processing failed"),
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
      await onboardNurseToFacility(facility, facilityId!, nurseId, event.account_id);
    } catch {
      // already logged inside onboardNurseToFacility
    }
  }
}

function extractFacilityId(shift: ShiftRecord): string | null {
  const v = shift.fields[getSchema().locationFieldId];
  if (typeof v === "string") return v;
  return null;
}
