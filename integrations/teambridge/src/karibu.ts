// Authenticated client for the Karibu backend, scoped to a single Karibu org via
// the facility's resolved base URL + API key. Generic for now — add typed wrappers
// (inviteUser, etc.) on top of `karibuFetch` as concrete endpoints land.

import type { Facility } from "./facilities.js";

export class KaribuApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body: string,
  ) {
    super(`Karibu API ${status} ${path}: ${body.slice(0, 200)}`);
    this.name = "KaribuApiError";
  }
}

export async function karibuFetch<T = unknown>(
  facility: Facility,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = new URL(path, facility.karibuBaseUrl).toString();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${facility.karibuApiKey}`);
  headers.set("Accept", "application/json");
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new KaribuApiError(res.status, path, body);
  }
  return (await res.json()) as T;
}
