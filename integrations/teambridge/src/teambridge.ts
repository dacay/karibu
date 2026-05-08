import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { getAccessToken } from "./auth.js";
import { getSchema } from "./schema.js";

const TASK_TEMPLATE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 14 14" height="14" width="14"><path stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round" d="M12.5726 1.88053C13.2419 2.57778 13.2192 3.68559 12.522 4.35489C11.8697 4.98106 11.073 5.95613 9.76254 7.58337C8.44296 9.22192 7.24855 10.8432 6.73827 11.7593C6.44729 12.2816 5.90974 12.6193 5.31283 12.6546C4.71592 12.69 4.14229 12.4181 3.79173 11.9336C3.62656 11.7054 3.23537 11.259 2.75705 10.7632C2.28475 10.2736 1.8341 9.84617 1.58615 9.64461C0.836174 9.03497 0.722413 7.93279 1.33205 7.18282C1.94169 6.43285 3.04388 6.31908 3.79385 6.92872C4.1327 7.20417 4.57376 7.62134 4.99723 8.04822C5.61575 7.18926 6.33356 6.26107 7.03662 5.38807C8.3623 3.74196 9.27527 2.61991 10.0982 1.82993C10.7955 1.16063 11.9033 1.18328 12.5726 1.88053Z" clip-rule="evenodd"></path></svg>';

interface RecordResponse {
  data: {
    metadata: { recordId: string };
    data: Record<string, unknown>;
  };
  error: unknown;
}

export interface ShiftRecord {
  recordId: string;
  fields: Record<string, unknown>;
}

export interface TeambridgeUser {
  email: string | null;
  roleIds: string[];
}

const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

async function tbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return fetch(`${config.teambridge.apiBase}${path}`, { ...init, headers });
}

// Extract UUIDs from a LINK_TO_* field value. Per the Teambridge OpenAPI the value
// can be a single UUID, a comma-separated string, or an array of strings/objects.
function extractLinkUuids(v: unknown): string[] {
  if (typeof v === "string") {
    return v
      .split(",")
      .map((s) => s.trim())
      .filter((s) => UUID_RE.test(s));
  }
  if (Array.isArray(v)) {
    return v
      .map((item) => (typeof item === "string" ? item : ((item as { id?: string })?.id ?? null)))
      .filter((s): s is string => typeof s === "string" && UUID_RE.test(s));
  }
  return [];
}

export async function getShift(recordId: string): Promise<ShiftRecord> {
  const { shiftCollectionId } = getSchema();
  const res = await tbFetch(`/v1/collections/${shiftCollectionId}/records/${recordId}`);
  if (!res.ok) {
    throw new Error(`Get shift ${recordId} failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as RecordResponse;
  return {
    recordId: body.data.metadata.recordId,
    fields: body.data.data,
  };
}

export async function getUser(userId: string): Promise<TeambridgeUser> {
  const { usersCollectionId, userEmailFieldId, userRolesFieldId } = getSchema();
  const res = await tbFetch(`/v1/collections/${usersCollectionId}/records/${userId}`);
  if (!res.ok) {
    throw new Error(`Get user ${userId} failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as RecordResponse;
  const emailV = body.data.data[userEmailFieldId];
  const rolesV = body.data.data[userRolesFieldId];
  return {
    email: typeof emailV === "string" && emailV.length > 0 ? emailV : null,
    roleIds: extractLinkUuids(rolesV),
  };
}

// Tasks are NOT supported by the unified collections API — Teambridge requires
// the dedicated `/tasks/template` endpoint on api.teambridge.com, authenticated
// with a static bearer token (config.teambridge.web.token), not the OAuth client.
// The template carries an external link; assignment to a user happens later in
// a separate call (TBD).
export async function createTaskTemplate(
  name: string,
  url: string,
): Promise<{ id: string | null; displayId: string }> {
  const displayId = `task.template.${randomUUID()}`;
  const body = {
    name,
    iconInfo: { backgroundColor: "#00A76F", content: TASK_TEMPLATE_ICON_SVG },
    displayId,
    description: "",
    type: "EXTERNAL_LINK",
    taskData: { type: "EXTERNAL_LINK", url },
    customFieldInfo: {
      customFieldValues: [],
      customFieldSchemas: [],
      descriptionVisible: true,
      dueDateVisible: true,
    },
    configuration: {
      autoComplete: true,
      isExternal: true,
      isPublished: true,
      canCreateMultiple: false,
    },
  };
  const res = await fetch(`${config.teambridge.web.apiBase}/tasks/template`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.teambridge.web.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Create task template failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { data?: { id?: string } };
  const id = json.data?.id ?? null;
  return { id, displayId };
}

// Assigns a task template to a user by creating a task instance.
// Endpoint: POST {web.apiBase}/collections/v2/create_record (also not in OpenAPI).
// The recordId is minted client-side; schemaId values come from discoverSchema().
export async function assignTask(opts: {
  accountId: string;
  templateId: string;
  assigneeId: string;
}): Promise<{ recordId: string }> {
  const { tasksCollectionId, taskTemplateFieldId, taskAssigneeFieldId } = getSchema();
  const recordId = randomUUID();
  const body = {
    recordId,
    accountId: opts.accountId,
    collectionType: "task",
    collectionId: tasksCollectionId,
    schemaProperties: [
      { schemaId: taskTemplateFieldId, type: "uuid", uuid: opts.templateId },
      { schemaId: taskAssigneeFieldId, type: "uuid", uuid: opts.assigneeId },
    ],
    nonSchemaProperties: [],
  };
  const res = await fetch(`${config.teambridge.web.apiBase}/collections/v2/create_record`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.teambridge.web.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Assign task failed: ${res.status} ${await res.text()}`);
  }
  return { recordId };
}

export function extractAssigneeIds(shift: ShiftRecord): string[] {
  return extractLinkUuids(shift.fields[getSchema().shiftAssigneeFieldId]);
}

// Deletes one or more records from a collection via the Teambridge "web" API
// (POST /collections/delete_records). The unified Open API has no equivalent
// — same situation as task creation/assignment. Uses the static web bearer.
export async function deleteRecords(opts: {
  accountId: string;
  collectionId: string;
  recordIds: string[];
}): Promise<void> {
  const res = await fetch(`${config.teambridge.web.apiBase}/collections/delete_records`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.teambridge.web.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      collectionId: opts.collectionId,
      recordIds: opts.recordIds,
      accountId: opts.accountId,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Delete records ${opts.recordIds.join(",")} on ${opts.collectionId} failed: ${res.status} ${await res.text()}`,
    );
  }
}

// Deactivates a task template via the Teambridge "web" API. Required step
// before deletion — DELETE /tasks/template/{id} on an active template is rejected.
// PUT with no body. Uses the static web bearer (same as createTaskTemplate).
export async function deactivateTaskTemplate(templateId: string): Promise<void> {
  const res = await fetch(
    `${config.teambridge.web.apiBase}/tasks/template/${templateId}/inactive`,
    {
      method: "PUT",
      headers: { authorization: `Bearer ${config.teambridge.web.token}` },
    },
  );
  if (!res.ok) {
    throw new Error(
      `Deactivate task template ${templateId} failed: ${res.status} ${await res.text()}`,
    );
  }
}

// Deletes a (previously deactivated) task template via the Teambridge "web" API.
// DELETE with no body. Uses the static web bearer.
export async function deleteTaskTemplate(templateId: string): Promise<void> {
  const res = await fetch(
    `${config.teambridge.web.apiBase}/tasks/template/${templateId}`,
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${config.teambridge.web.token}` },
    },
  );
  if (!res.ok) {
    throw new Error(
      `Delete task template ${templateId} failed: ${res.status} ${await res.text()}`,
    );
  }
}

// Writes a single field on a shift record. Used to mark "Karibu Completed" once
// the nurse completes their verification microlearning, and to auto-populate
// it on every subsequent shift assigned to the same nurse at the same facility.
//
// Teambridge's updateRecord endpoint is PUT (not PATCH), but per the OpenAPI
// description it's still a partial update — only the fields you include change.
export async function setShiftField(
  shiftId: string,
  fieldId: string,
  value: string,
): Promise<void> {
  const { shiftCollectionId } = getSchema();
  const res = await tbFetch(`/v1/collections/${shiftCollectionId}/records/${shiftId}`, {
    method: "PUT",
    body: JSON.stringify({ data: { [fieldId]: value } }),
  });
  if (!res.ok) {
    throw new Error(`Set shift field ${fieldId} on ${shiftId} failed: ${res.status} ${await res.text()}`);
  }
}
