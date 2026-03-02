const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

function getToken(): string | null {
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
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", gender: "female", description: "Calm, professional" },
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
  topicId: string | null;
  subtopicIds: string[] | null;
  patternId: string | null;
  avatarId: string | null;
  sequenceId: string | null;
  position: number | null;
  createdAt: string;
  updatedAt: string;
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
    listSequences: () =>
      request<{ sequences: MicrolearningSequence[] }>("/microlearnings/sequences"),
    createSequence: (body: { name: string; description?: string }) =>
      request<{ sequence: MicrolearningSequence }>("/microlearnings/sequences", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    updateSequence: (id: string, body: { name?: string; description?: string }) =>
      request<{ sequence: MicrolearningSequence }>(`/microlearnings/sequences/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    deleteSequence: (id: string) =>
      request<{ success: boolean }>(`/microlearnings/sequences/${id}`, { method: "DELETE" }),
    reorderSequence: (id: string, microlearningIds: string[]) =>
      request<{ success: boolean }>(`/microlearnings/sequences/${id}/reorder`, {
        method: "PUT",
        body: JSON.stringify({ microlearningIds }),
      }),
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
  org: {
    getConfig: () => request<OrgConfig>("/org/config"),
    updateConfig: (body: { name?: string; pronunciation?: string | null }) =>
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
