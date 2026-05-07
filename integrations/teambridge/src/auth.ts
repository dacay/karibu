import { config } from "./config.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "auth" });

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

let cached: { token: string; expiresAt: number } | null = null;
let inFlight: Promise<string> | null = null;

async function fetchToken(): Promise<string> {
  const res = await fetch(config.teambridge.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: config.teambridge.clientId,
      client_secret: config.teambridge.clientSecret,
      audience: config.teambridge.audience,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token request failed: ${res.status} ${body}`);
  }
  const json = (await res.json()) as TokenResponse;
  cached = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  log.info({ expiresInSec: json.expires_in }, "fetched new access token");
  return json.access_token;
}

export async function getAccessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;
  if (inFlight) return inFlight;
  inFlight = fetchToken().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export function startTokenRefreshLoop(): void {
  const HOUR = 60 * 60 * 1000;
  setInterval(() => {
    fetchToken().catch((err) => log.error({ err }, "scheduled token refresh failed"));
  }, HOUR);
}
