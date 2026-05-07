// First-time onboarding for a (nurse, facility) pair:
//   1. Cheap DB pre-check — already onboarded? skip (no Teambridge API call).
//   2. Fetch the nurse's user record from Teambridge (email + role IDs).
//   3. Eligibility filter — skip if their roles don't intersect TEAMBRIDGE_ELIGIBLE_ROLES.
//      No DB row is written for ineligible nurses; a later role change will be picked up
//      automatically on the next webhook.
//   4. Skip if the user has no email (we have nothing to invite with).
//   5. Claim a row in teambridge_nurse_facility_invites (PK conflict ⇒ another worker
//      handled it concurrently, no-op).
//   6. POST /team/invite to that facility's Karibu org. Idempotent — already-existing
//      users land in `alreadyExists`.
//   7. Create a "Karibu Verification @ <facility>" task *template* in Teambridge
//      (web API, not Open API). The template carries the nurse-specific Karibu
//      sign-in link as its EXTERNAL_LINK url.
//   8. Assign the template to the nurse via /collections/v2/create_record (also
//      web API), minting a task instance recordId we persist.
// On any failure after step 5, the claim row is DELETED so the next webhook retries.

import { and, eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { teambridgeNurseFacilityInvites } from "./db/schema.js";
import { logger } from "./logger.js";
import { karibuFetch, KaribuApiError } from "./karibu.js";
import { getUser, createTaskTemplate, assignTask } from "./teambridge.js";
import { isRoleEligible } from "./schema.js";
import type { Facility } from "./facilities.js";

const log = logger.child({ module: "onboarding" });

interface InviteResponse {
  invited: { email: string; link: string }[];
  alreadyExists: string[];
  failed: string[];
}

export async function onboardNurseToFacility(
  facility: Facility,
  facilityId: string,
  nurseId: string,
  accountId: string,
): Promise<void> {
  const ctx = { facilityId, facilityName: facility.name, nurseId };

  const existing = await db
    .select({ nurseId: teambridgeNurseFacilityInvites.nurseId })
    .from(teambridgeNurseFacilityInvites)
    .where(
      and(
        eq(teambridgeNurseFacilityInvites.nurseId, nurseId),
        eq(teambridgeNurseFacilityInvites.facilityId, facilityId),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    log.debug(ctx, "nurse already onboarded to facility, skipping");
    return;
  }

  const user = await getUser(nurseId);

  if (!isRoleEligible(user.roleIds)) {
    log.info(
      { ...ctx, roleIds: user.roleIds },
      "skipped: nurse's roles do not match TEAMBRIDGE_ELIGIBLE_ROLES",
    );
    return;
  }

  if (!user.email) {
    log.warn(ctx, "skipped: Teambridge user has no email — cannot invite to Karibu");
    return;
  }

  const claimed = await db
    .insert(teambridgeNurseFacilityInvites)
    .values({ nurseId, facilityId })
    .onConflictDoNothing()
    .returning({ nurseId: teambridgeNurseFacilityInvites.nurseId });
  if (claimed.length === 0) {
    log.debug(ctx, "concurrent claim — another worker is onboarding this pair");
    return;
  }

  const where = and(
    eq(teambridgeNurseFacilityInvites.nurseId, nurseId),
    eq(teambridgeNurseFacilityInvites.facilityId, facilityId),
  );

  try {
    const inviteResp = await karibuFetch<InviteResponse>(facility, "/team/invite", {
      method: "POST",
      body: JSON.stringify({ emails: user.email }),
    });
    await db.update(teambridgeNurseFacilityInvites).set({ karibuInvitedAt: new Date() }).where(where);
    log.info(
      {
        ...ctx,
        email: user.email,
        invited: inviteResp.invited.length,
        alreadyExists: inviteResp.alreadyExists.length,
        failed: inviteResp.failed.length,
      },
      "nurse invited to Karibu org",
    );

    const link = inviteResp.invited[0]?.link;
    if (!link) {
      log.warn(
        { ...ctx, alreadyExists: inviteResp.alreadyExists.length },
        "no invite link in response — skipping Teambridge task template creation",
      );
      return;
    }

    const template = await createTaskTemplate(`Karibu Verification @ ${facility.name}`, link);
    await db
      .update(teambridgeNurseFacilityInvites)
      .set({
        taskCreatedAt: new Date(),
        taskTemplateId: template.id,
        taskTemplateDisplayId: template.displayId,
      })
      .where(where);
    log.info(
      { ...ctx, taskTemplateId: template.id, taskTemplateDisplayId: template.displayId },
      "verification task template created in Teambridge",
    );

    if (!template.id) {
      log.error(
        ctx,
        "task template created but response had no id — cannot assign to nurse",
      );
      return;
    }

    const assigned = await assignTask({
      accountId,
      templateId: template.id,
      assigneeId: nurseId,
    });
    await db
      .update(teambridgeNurseFacilityInvites)
      .set({ taskRecordId: assigned.recordId })
      .where(where);
    log.info(
      { ...ctx, taskRecordId: assigned.recordId, templateId: template.id },
      "verification task assigned to nurse in Teambridge",
    );
  } catch (err) {
    await db.delete(teambridgeNurseFacilityInvites).where(where);
    if (err instanceof KaribuApiError) {
      log.error({ ...ctx, status: err.status, body: err.body }, "Karibu invite failed");
    } else {
      log.error({ ...ctx, err }, "nurse onboarding failed");
    }
    throw err;
  }
}
