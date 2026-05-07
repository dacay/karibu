import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  schemaFilter: ["integrations"],
  tablesFilter: ["teambridge_*"],
  migrations: {
    schema: "integrations",
    table: "__drizzle_migrations_teambridge",
  },
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
