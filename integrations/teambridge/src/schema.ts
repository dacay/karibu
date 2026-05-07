import { config } from "./config.js";
import { logger } from "./logger.js";
import { getAccessToken } from "./auth.js";

const log = logger.child({ module: "schema" });

interface CollectionSummary {
  id: string;
  name: string;
  type: string;
}

interface FieldDef {
  id: string;
  name: string;
  type: string;
  readOnly: boolean;
  linkedCollectionId?: string;
}

interface RoleRecord {
  metadata: { recordId: string };
  data: Record<string, unknown>;
}

interface DiscoveredSchema {
  shiftCollectionId: string;
  locationFieldId: string;
  shiftAssigneeFieldId: string;
  shiftFields: FieldDef[];
  shiftFieldsById: Map<string, FieldDef>;

  usersCollectionId: string;
  userEmailFieldId: string;
  userRolesFieldId: string;

  tasksCollectionId: string;
  taskTitleFieldId: string;
  taskAssigneeFieldId: string;
  // The "Task Template" field on the tasks collection. Typed SINGLE_SELECT
  // (writeFormatHint=single_uuid) but the options are dynamic — they're
  // template UUIDs we mint via POST /tasks/template. Used as a schemaId in
  // the assign payload to api.teambridge.com/collections/v2/create_record.
  taskTemplateFieldId: string;

  // null = no role filter configured (TEAMBRIDGE_ELIGIBLE_ROLES unset).
  // Set = onboarding only proceeds for users with at least one matching role ID.
  eligibleRoleIds: Set<string> | null;
}

let cached: DiscoveredSchema | null = null;

async function api<T>(path: string): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${config.teambridge.apiBase}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

function findOneOrThrow<T>(items: T[], pred: (x: T) => boolean, label: string): T {
  const matches = items.filter(pred);
  if (matches.length === 0) {
    throw new Error(`schema discovery: no match for ${label}`);
  }
  if (matches.length > 1) {
    log.warn({ label, count: matches.length }, "schema discovery: multiple matches, picking first");
  }
  return matches[0]!;
}

function findNamedOrFirstText(fields: FieldDef[], collectionLabel: string): FieldDef {
  // Prefer a writable field named "Name"/"Title"; fall back to first writable TEXT.
  const named = fields.find((f) => !f.readOnly && /^(name|title)$/i.test(f.name));
  if (named) return named;
  const text = fields.find((f) => !f.readOnly && f.type === "TEXT");
  if (text) return text;
  throw new Error(
    `schema discovery: ${collectionLabel} has no writable field named Name/Title or any writable TEXT field`,
  );
}

export async function discoverSchema(): Promise<DiscoveredSchema> {
  if (cached) return cached;

  const collectionsResp = await api<{ data: { collections: CollectionSummary[] } }>(
    "/v1/collections",
  );
  const collections = collectionsResp.data.collections;

  const shifts = findOneOrThrow(collections, (c) => c.type === "shift", "collection type=shift");
  const users = findOneOrThrow(collections, (c) => c.type === "user", "collection type=user");
  const tasks = findOneOrThrow(collections, (c) => c.type === "task", "collection type=task");
  const roles = findOneOrThrow(collections, (c) => c.type === "role", "collection type=role");

  const [shiftFieldsResp, userFieldsResp, taskFieldsResp, roleFieldsResp] = await Promise.all([
    api<{ data: FieldDef[] }>(`/v1/collections/${shifts.id}/fields`),
    api<{ data: FieldDef[] }>(`/v1/collections/${users.id}/fields`),
    api<{ data: FieldDef[] }>(`/v1/collections/${tasks.id}/fields`),
    api<{ data: FieldDef[] }>(`/v1/collections/${roles.id}/fields`),
  ]);
  const shiftFields = shiftFieldsResp.data;
  const userFields = userFieldsResp.data;
  const taskFields = taskFieldsResp.data;
  const roleFields = roleFieldsResp.data;

  const location = findOneOrThrow(
    shiftFields,
    (f) => f.type === "LINK_TO_LOCATION",
    "shift field type=LINK_TO_LOCATION",
  );
  const shiftAssignee = findOneOrThrow(
    shiftFields,
    (f) => f.type === "LINK_TO_USER",
    "shift field type=LINK_TO_USER (assignee)",
  );

  const userEmail = findOneOrThrow(
    userFields,
    (f) => f.type === "EMAIL",
    "user field type=EMAIL",
  );
  const userRoles = findOneOrThrow(
    userFields,
    (f) => f.type === "LINK_TO_ROLE",
    "user field type=LINK_TO_ROLE",
  );

  const taskTitle = findNamedOrFirstText(taskFields, "task collection");
  const taskAssignee = findOneOrThrow(
    taskFields,
    (f) => f.type === "LINK_TO_USER",
    "task field type=LINK_TO_USER (assignee)",
  );
  const taskTemplate = findOneOrThrow(
    taskFields,
    (f) => /^task\s*template$/i.test(f.name) && f.type === "SINGLE_SELECT",
    'task field name="Task Template" type=SINGLE_SELECT',
  );

  const roleNameField = findNamedOrFirstText(roleFields, "role collection");

  // Resolve eligible role names → role UUIDs by listing the role records once.
  let eligibleRoleIds: Set<string> | null = null;
  if (config.teambridge.eligibleRoles.length === 0) {
    log.warn(
      "TEAMBRIDGE_ELIGIBLE_ROLES is empty — every shift assignee will be onboarded. Set this in production.",
    );
  } else {
    const rolesResp = await api<{ data: { records: RoleRecord[] } }>(
      `/v1/collections/${roles.id}/records?size=500`,
    );
    const records = rolesResp.data.records;
    const nameToId = new Map<string, string>();
    for (const r of records) {
      const name = r.data[roleNameField.id];
      if (typeof name === "string" && name.length > 0) {
        nameToId.set(name.trim().toLowerCase(), r.metadata.recordId);
      }
    }

    const resolved = new Set<string>();
    const missing: string[] = [];
    for (const wanted of config.teambridge.eligibleRoles) {
      const id = nameToId.get(wanted.toLowerCase());
      if (id) resolved.add(id);
      else missing.push(wanted);
    }
    if (missing.length > 0) {
      throw new Error(
        `TEAMBRIDGE_ELIGIBLE_ROLES contains unknown role names: ${missing.join(", ")}. ` +
          `Known roles: ${[...nameToId.keys()].join(", ")}`,
      );
    }
    eligibleRoleIds = resolved;
  }

  cached = {
    shiftCollectionId: shifts.id,
    locationFieldId: location.id,
    shiftAssigneeFieldId: shiftAssignee.id,
    shiftFields,
    shiftFieldsById: new Map(shiftFields.map((f) => [f.id, f])),
    usersCollectionId: users.id,
    userEmailFieldId: userEmail.id,
    userRolesFieldId: userRoles.id,
    tasksCollectionId: tasks.id,
    taskTitleFieldId: taskTitle.id,
    taskAssigneeFieldId: taskAssignee.id,
    taskTemplateFieldId: taskTemplate.id,
    eligibleRoleIds,
  };

  log.info(
    {
      shiftCollectionId: cached.shiftCollectionId,
      locationFieldId: cached.locationFieldId,
      shiftAssigneeFieldId: cached.shiftAssigneeFieldId,
      usersCollectionId: cached.usersCollectionId,
      userEmailFieldId: cached.userEmailFieldId,
      userRolesFieldId: cached.userRolesFieldId,
      tasksCollectionId: cached.tasksCollectionId,
      taskTitleFieldId: cached.taskTitleFieldId,
      taskAssigneeFieldId: cached.taskAssigneeFieldId,
      taskTemplateFieldId: cached.taskTemplateFieldId,
      eligibleRoleCount: cached.eligibleRoleIds?.size ?? null,
      shiftFieldCount: cached.shiftFields.length,
    },
    "discovered tenant schema",
  );

  return cached;
}

export function getSchema(): DiscoveredSchema {
  if (!cached) throw new Error("Schema not yet discovered — call discoverSchema() at startup");
  return cached;
}

export function fieldName(fieldId: string): string {
  return cached?.shiftFieldsById.get(fieldId)?.name ?? fieldId;
}

export function isRoleEligible(userRoleIds: string[]): boolean {
  const s = getSchema();
  if (s.eligibleRoleIds === null) return true;
  return userRoleIds.some((id) => s.eligibleRoleIds!.has(id));
}
