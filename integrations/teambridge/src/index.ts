import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { getAccessToken, startTokenRefreshLoop } from "./auth.js";
import { discoverSchema } from "./schema.js";
import { handleWebhook } from "./webhook.js";
import { cleanupOldEvents } from "./state.js";

const app = new Hono();

app.get("/", (c) =>
  c.json({
    service: "teambridge-integration",
    endpoints: ["GET /health", "POST /webhooks/teambridge"],
  }),
);
app.get("/health", (c) => c.json({ ok: true }));
app.post("/webhooks/teambridge", handleWebhook);

function startEventCleanupLoop() {
  const log = logger.child({ module: "cleanup" });
  const days = config.teambridge.eventRetentionDays;
  if (days <= 0) {
    log.warn("TEAMBRIDGE_EVENT_RETENTION_DAYS<=0, periodic events cleanup disabled");
    return;
  }
  const run = async () => {
    try {
      await cleanupOldEvents(days);
    } catch (err) {
      log.error({ err }, "events cleanup failed");
    }
  };
  void run();
  setInterval(run, 60 * 60 * 1000);
}

async function main() {
  await getAccessToken();
  startTokenRefreshLoop();
  await discoverSchema();
  startEventCleanupLoop();

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info({ port: info.port }, `server listening on http://localhost:${info.port}`);
  });
}

main().catch((err) => {
  logger.fatal({ err }, "fatal error during startup");
  process.exit(1);
});
