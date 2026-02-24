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
    deleteValue: (id: string) =>
      request<{ success: boolean }>(`/dna/values/${id}`, { method: "DELETE" }),
  },
  team: {
    list: () =>
      request<{ users: TeamMember[] }>("/team"),
    invite: (emails: string) =>
      request<InviteResult>("/team/invite", {
        method: "POST",
        body: JSON.stringify({ emails }),
      }),
    resendInvite: (userId: string) =>
      request<{ success: boolean }>(`/team/${userId}/resend-invite`, { method: "POST" }),
    regenerateToken: (userId: string) =>
      request<{ success: boolean }>(`/team/${userId}/regenerate-token`, { method: "POST" }),
    remove: (userId: string) =>
      request<{ success: boolean }>(`/team/${userId}`, { method: "DELETE" }),
  },
};
