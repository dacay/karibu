export function getApiBaseUrl(): string {
  const template = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
  if (!template.includes("{subdomain}") || typeof window === "undefined") return template;
  const subdomain = window.location.hostname.split(".")[0];
  return template.replace("{subdomain}", subdomain);
}

const BASE_URL = getApiBaseUrl();

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("karibu_token");
}

async function handleResponse<T>(res: Response, skipAuthRedirect = false): Promise<T> {
  if (res.status === 401 && typeof window !== "undefined" && !skipAuthRedirect) {
    localStorage.removeItem("karibu_token");
    localStorage.removeItem("karibu_user");
    window.location.href = "/login";
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { message?: string; error?: string }).message ??
      (body as { message?: string; error?: string }).error ??
      `Request failed: ${res.status}`
    );
  }

  return res.json() as Promise<T>;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  return handleResponse<T>(res, path.startsWith("/auth/"));
}

async function upload<T>(path: string, formData: FormData): Promise<T> {
  const token = getToken();

  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

  return handleResponse<T>(res);
}

// ----- Types -----

export interface DnaValue {
  id: string;
  subtopicId: string;
  organizationId: string;
  content: string;
  approval: "pending" | "approved" | "rejected";
  userEdited: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DnaSubtopic {
  id: string;
  topicId: string;
  organizationId: string;
  name: string;
  description: string;
  source: "manual" | "discovered";
  status: "suggested" | "active" | "rejected";
  synthesisStatus: "idle" | "running" | "done" | "failed";
  lastSynthesizedAt: string | null;
  createdAt: string;
  updatedAt: string;
  values: DnaValue[];
}

export interface DnaTopic {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  source: "manual" | "discovered";
  status: "suggested" | "active" | "rejected";
  createdAt: string;
  updatedAt: string;
  subtopics: DnaSubtopic[];
}

export interface LoginResponse {
  token: string;
  user: {
    id: string;
    email: string;
    role: "admin" | "user";
    organizationId: string;
    organizationName: string;
  };
}

export interface Document {
  id: string;
  organizationId: string;
  uploadedBy: string;
  name: string;
  s3Key: string;
  s3Bucket: string;
  mimeType: string;
  sizeBytes: number;
  status: "uploaded" | "processing" | "processed" | "failed";
  chromaDocumentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationPattern {
  id: string;
  organizationId: string | null;
  name: string;
  description: string;
  prompt: string;
  isBuiltIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Avatar {
  id: string;
  organizationId: string | null;
  name: string;
  personality: string;
  imageS3Key: string | null;
  imageS3Bucket: string | null;
  voiceId: string;
  isBuiltIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ElevenLabsVoice {
  id: string;
  name: string;
  gender: "male" | "female";
  description: string;
}

export const ELEVENLABS_VOICES: ElevenLabsVoice[] = [
  // Female voices
  { id: "56AoDkrOh6qfVPDXZ7Pt", name: "Cassidy", gender: "female", description: "Crisp, direct and clear" },
  { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi", gender: "female", description: "Strong, expressive" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", gender: "female", description: "Soft, pleasant" },
  { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli", gender: "female", description: "Warm, emotional" },
  { id: "LcfcDJNUP1GQjkzn1xUU", name: "Emily", gender: "female", description: "Calm, clear" },
  // Male voices
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", gender: "male", description: "Deep, authoritative" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni", gender: "male", description: "Well-rounded, engaging" },
  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold", gender: "male", description: "Crisp, confident" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh", gender: "male", description: "Deep, conversational" },
  { id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam", gender: "male", description: "Raspy, strong" },
];

export interface Microlearning {
  id: string;
  organizationId: string;
  title: string;
  status: "draft" | "published";
  topicId: string | null;
  subtopicIds: string[] | null;
  patternId: string | null;
  avatarId: string | null;
  sequenceId: string | null;
  position: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MicrolearningProgress {
  id: string;
  userId: string;
  microlearningId: string;
  status: "active" | "completed" | "expired";
  openedAt: string;
  completedAt: string | null;
  expiredAt: string | null;
}

export interface MicrolearningWithDetails extends Microlearning {
  avatar: Avatar | null;
  topic: { id: string; name: string } | null;
  progress: MicrolearningProgress | null;
}

export interface LearnerFeedML extends MicrolearningWithDetails {
  sequenceName: string | null;
}

export interface LearnerFeed {
  active: LearnerFeedML[];
  archive: LearnerFeedML[];
  expirationIntervalMs: number;
}

// Default fallback inactivity window (overridden by org config returned in the feed)
export const DEFAULT_INACTIVITY_WINDOW_MS = 8 * 60 * 60 * 1000; // 8 hours

export interface UserProfile {
  id: string;
  email: string;
  role: "admin" | "user";
  organizationId: string;
  preferredAvatarId: string | null;
}

export interface UserGroup {
  id: string;
  organizationId: string;
  name: string;
  isAll: boolean;
  memberCount: number;
  createdAt: string;
}

export interface SequenceAssignment {
  id: string;
  sequenceId: string;
  groupId: string;
  group: { id: string; name: string; isAll: boolean };
  createdAt: string;
}

export interface MicrolearningSequence {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  microlearnings: Microlearning[];
}


export interface TeamMember {
  id: string;
  email: string;
  role: "admin" | "user";
  createdAt: string;
  hasToken: boolean;
  tokenCreatedAt: string | null;
  tokenLastUsedAt: string | null;
  tokenExpired: boolean | null;
}

export interface InviteResult {
  invited: string[];
  alreadyExists: string[];
  failed: string[];
}

export interface OrgConfig {
  name: string;
  subdomain: string;
  pronunciation: string | null;
  learnerTerm: string;
  learnerTermPlural: string;
  expirationIntervalHours: number;
}

export interface FlaggedMessage {
  id: string;
  messageId: string;
  chatId: string;
  reason: string | null;
  status: "open" | "reviewed" | "dismissed";
  createdAt: string;
  updatedAt: string;
  flaggedByEmail: string;
  message: {
    role: string;
    parts: unknown;
    createdAt: string;
  };
  chat: {
    type: "microlearning" | "discussion";
    microlearningId: string | null;
    microlearningTitle: string | null;
  };
}

export interface DashboardMetrics {
  usageFrequency: {
    totalSessions: number;
    uniqueLearners: number;
    sessionsPerDay: Array<{ date: string; count: number }>;
  };
  sessionDuration: {
    avgMinutes: number | null;
    minMinutes: number | null;
    maxMinutes: number | null;
  };
  messagesPerDayPerNurse: Array<{
    userId: string;
    email: string;
    date: string;
    messageCount: number;
  }>;
  returnVisits: {
    total: number;
    totalLearners: number;
    percentOfLearners: number;
    deltaVsLastMonth: number;
    thisMonthCount: number;
    lastMonthCount: number;
    byMonth: Array<{ month: string; count: number }>;
  };
  completionMetrics: {
    avgMinutes: number | null;
    minMinutes: number | null;
    maxMinutes: number | null;
    avgMessages: number | null;
    minMessages: number | null;
    maxMessages: number | null;
  };
  completionsThisMonth: number;
}

export interface MLChatSession {
  chatId: string | null;
  messages: unknown[]; // UIMessage[] — typed at the call site
}

// ----- Namespaced API client -----

export const api = {
  auth: {
    login: (body: { email: string; password: string }) =>
      request<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },
  documents: {
    list: () =>
      request<{ documents: Document[] }>("/documents"),
    upload: (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return upload<{ document: Document }>("/documents/upload", formData);
    },
    delete: (id: string) =>
      request<{ success: boolean }>(`/documents/${id}`, { method: "DELETE" }),
  },
  dna: {
    list: () =>
      request<{ topics: DnaTopic[] }>("/dna"),
    createTopic: (body: { name: string; description: string }) =>
      request<{ topic: DnaTopic }>("/dna/topics", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    updateTopic: (id: string, body: { name?: string; description?: string }) =>
      request<{ topic: DnaTopic }>(`/dna/topics/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    deleteTopic: (id: string) =>
      request<{ success: boolean }>(`/dna/topics/${id}`, { method: "DELETE" }),
    createSubtopic: (topicId: string, body: { name: string; description: string }) =>
      request<{ subtopic: DnaSubtopic }>(`/dna/topics/${topicId}/subtopics`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    updateSubtopic: (id: string, body: { name?: string; description?: string }) =>
      request<{ subtopic: DnaSubtopic }>(`/dna/subtopics/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    deleteSubtopic: (id: string) =>
      request<{ success: boolean }>(`/dna/subtopics/${id}`, { method: "DELETE" }),
    synthesize: (subtopicId: string) =>
      request<{ success: boolean; valueCount: number }>(`/dna/subtopics/${subtopicId}/synthesize`, {
        method: "POST",
      }),
    updateValueApproval: (id: string, approval: "approved" | "rejected") =>
      request<{ value: DnaValue }>(`/dna/values/${id}/approval`, {
        method: "PATCH",
        body: JSON.stringify({ approval }),
      }),
    updateValueContent: (id: string, content: string) =>
      request<{ value: DnaValue }>(`/dna/values/${id}/content`, {
        method: "PATCH",
        body: JSON.stringify({ content }),
      }),
    deleteValue: (id: string) =>
      request<{ success: boolean }>(`/dna/values/${id}`, { method: "DELETE" }),
  },
  patterns: {
    list: () =>
      request<{ patterns: ConversationPattern[] }>("/patterns"),
    create: (body: { name: string; description: string; prompt: string }) =>
      request<{ pattern: ConversationPattern }>("/patterns", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    update: (id: string, body: { name?: string; description?: string; prompt?: string }) =>
      request<{ pattern: ConversationPattern }>(`/patterns/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    delete: (id: string) =>
      request<{ success: boolean }>(`/patterns/${id}`, { method: "DELETE" }),
  },
  microlearnings: {
    list: () =>
      request<{ microlearnings: Microlearning[] }>("/microlearnings"),
    create: (body: {
      title: string;
      topicId?: string | null;
      subtopicIds?: string[];
      patternId?: string | null;
      avatarId?: string | null;
      sequenceId?: string | null;
      position?: number | null;
    }) =>
      request<{ microlearning: Microlearning }>("/microlearnings", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    update: (id: string, body: {
      title?: string;
      status?: "draft" | "published";
      topicId?: string | null;
      subtopicIds?: string[];
      patternId?: string | null;
      avatarId?: string | null;
      sequenceId?: string | null;
      position?: number | null;
    }) =>
      request<{ microlearning: Microlearning }>(`/microlearnings/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    delete: (id: string) =>
      request<{ success: boolean }>(`/microlearnings/${id}`, { method: "DELETE" }),
    // User-facing endpoints
    myMicrolearnings: () =>
      request<{ microlearnings: MicrolearningWithDetails[] }>("/microlearnings/my"),
    getById: (id: string) =>
      request<{ microlearning: MicrolearningWithDetails; progress: MicrolearningProgress | null }>(`/microlearnings/${id}`),
  },
  sequences: {
    list: () =>
      request<{ sequences: MicrolearningSequence[] }>("/sequences"),
    create: (body: { name: string; description?: string }) =>
      request<{ sequence: MicrolearningSequence }>("/sequences", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    update: (id: string, body: { name?: string; description?: string }) =>
      request<{ sequence: MicrolearningSequence }>(`/sequences/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    delete: (id: string) =>
      request<{ success: boolean }>(`/sequences/${id}`, { method: "DELETE" }),
    reorder: (id: string, microlearningIds: string[]) =>
      request<{ success: boolean }>(`/sequences/${id}/reorder`, {
        method: "PATCH",
        body: JSON.stringify({ microlearningIds }),
      }),
    listAssignments: (id: string) =>
      request<{ assignments: SequenceAssignment[] }>(`/sequences/${id}/assignments`),
    assign: (id: string, groupId: string) =>
      request<{ assignment: SequenceAssignment }>(`/sequences/${id}/assignments`, {
        method: "POST",
        body: JSON.stringify({ groupId }),
      }),
    unassign: (id: string, groupId: string) =>
      request<{ success: boolean }>(`/sequences/${id}/assignments/${groupId}`, {
        method: "DELETE",
      }),
  },
  userGroups: {
    list: () =>
      request<{ groups: UserGroup[] }>("/user-groups"),
    create: (body: { name: string }) =>
      request<{ group: UserGroup }>("/user-groups", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    update: (id: string, body: { name: string }) =>
      request<{ group: UserGroup }>(`/user-groups/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    delete: (id: string) =>
      request<{ success: boolean }>(`/user-groups/${id}`, { method: "DELETE" }),
    addMember: (groupId: string, userId: string) =>
      request<{ added: string[] }>(`/user-groups/${groupId}/members`, {
        method: "POST",
        body: JSON.stringify({ userIds: [userId] }),
      }),
    removeMember: (groupId: string, userId: string) =>
      request<{ success: boolean }>(`/user-groups/${groupId}/members/${userId}`, { method: "DELETE" }),
  },
  team: {
    list: () =>
      request<{ users: TeamMember[] }>("/team"),
    invite: (emails: string) =>
      request<InviteResult>("/team/invite", {
        method: "POST",
        body: JSON.stringify({ emails }),
      }),
    getLink: (userId: string) =>
      request<{ link: string }>(`/team/${userId}/link`),
    resendInvite: (userId: string) =>
      request<{ success: boolean }>(`/team/${userId}/resend-invite`, { method: "POST" }),
    regenerateToken: (userId: string) =>
      request<{ success: boolean }>(`/team/${userId}/regenerate-token`, { method: "POST" }),
    remove: (userId: string) =>
      request<{ success: boolean }>(`/team/${userId}`, { method: "DELETE" }),
  },
  user: {
    me: () =>
      request<{ user: UserProfile }>("/user/me"),
    updatePreferences: (body: { preferredAvatarId: string | null }) =>
      request<{ user: UserProfile }>("/user/preferences", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
  },
  org: {
    getConfig: () => request<OrgConfig>("/org/config"),
    updateConfig: (body: { name?: string; pronunciation?: string | null; learnerTerm?: string; learnerTermPlural?: string; expirationIntervalHours?: number }) =>
      request<OrgConfig>("/org/config", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    uploadLogo: (variant: "light" | "dark", file: File) => {
      const formData = new FormData();
      formData.append("variant", variant);
      formData.append("file", file);
      return upload<{ success: boolean; key: string }>("/org/logo", formData);
    },
  },
  metrics: {
    get: () => request<DashboardMetrics>("/metrics"),
  },
  flags: {
    flag: (body: { messageId: string; chatId: string; reason?: string }) =>
      request<{ flag: { id: string } }>("/flags", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    count: () =>
      request<{ count: number }>("/flags/count"),
    list: () =>
      request<{ flags: FlaggedMessage[] }>("/flags"),
    updateStatus: (id: string, status: "reviewed" | "dismissed") =>
      request<{ flag: FlaggedMessage }>(`/flags/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
  },
  learner: {
    feed: () => request<LearnerFeed>("/microlearnings/feed"),
  },
  chat: {
    loadMLSession: (microlearningId: string) =>
      request<MLChatSession>(`/chat/ml/${microlearningId}`),
  },
  avatars: {
    list: () =>
      request<{ avatars: Avatar[] }>("/avatars"),
    create: (formData: FormData) =>
      upload<{ avatar: Avatar }>("/avatars", formData),
    update: (id: string, formData: FormData) => {
      const token = getToken();
      return fetch(`${BASE_URL}/avatars/${id}`, {
        method: "PATCH",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: formData,
      }).then((res) => handleResponse<{ avatar: Avatar }>(res));
    },
    delete: (id: string) =>
      request<{ success: boolean }>(`/avatars/${id}`, { method: "DELETE" }),
  },
};
