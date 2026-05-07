import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required("DATABASE_URL"),
  teambridge: {
    clientId: required("TEAMBRIDGE_CLIENT_ID"),
    clientSecret: required("TEAMBRIDGE_CLIENT_SECRET"),
    audience: process.env.TEAMBRIDGE_AUDIENCE ?? "https://api.teambridge.com/openapi/",
    tokenUrl: process.env.TEAMBRIDGE_TOKEN_URL ?? "https://teambridge.us.auth0.com/oauth/token",
    apiBase: process.env.TEAMBRIDGE_API_BASE ?? "https://open-api.teambridge.com",
    // Tasks aren't creatable via the unified Open API. The Teambridge "web" API
    // (api.teambridge.com) accepts a static bearer token — no OAuth exchange.
    web: {
      token: required("TEAMBRIDGE_WEB_TOKEN"),
      apiBase: process.env.TEAMBRIDGE_WEB_API_BASE ?? "https://api.teambridge.com",
    },
    webhookSecret: required("TEAMBRIDGE_WEBHOOK_SECRET"),
    // Set to "false" to skip HMAC verification on incoming webhooks.
    // Useful when debugging connectivity / payload handling without a valid secret.
    verifyWebhookSignature: (process.env.VERIFY_WEBHOOK_SIGNATURE ?? "true") !== "false",
    // Comma-separated list of Teambridge role names that gate Karibu onboarding.
    // Only assignees holding at least one of these roles get invited + a verification
    // task. Empty/unset disables the filter (logs a warn at boot — set this in prod).
    eligibleRoles: (process.env.TEAMBRIDGE_ELIGIBLE_ROLES ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    // How many days to keep rows in `integrations.teambridge_events`. The table is
    // only used for dedup (Teambridge retries within minutes), so a small value is
    // enough; anything older is incidental audit. 0 disables the periodic cleanup.
    eventRetentionDays: Number(process.env.TEAMBRIDGE_EVENT_RETENTION_DAYS ?? 30),
  },
  // Path to the facilities mapping file (Teambridge location UUID → Karibu org).
  // Per-tenant: location UUIDs differ between sandbox and prod, so point this at
  // facilities.sandbox.json or facilities.prod.json depending on env.
  facilitiesFile: process.env.FACILITIES_FILE ?? "facilities.json",
};
