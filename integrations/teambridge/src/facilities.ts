import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, isAbsolute } from "node:path";
import { config } from "./config.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "facilities" });

// Raw shape as it appears in facilities.*.json — keys are Teambridge location UUIDs.
// `karibu_api_key_env` names an env var; we resolve to the real key at load time so
// secrets stay in .env and the JSON is safe to commit.
interface FacilityFile {
  name: string;
  location_id?: string | null;
  karibu_base_url: string;
  karibu_api_key_env: string;
}

export interface Facility {
  name: string;
  location_id: string | null;
  karibuBaseUrl: string;
  karibuApiKey: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const filePath = isAbsolute(config.facilitiesFile)
  ? config.facilitiesFile
  : resolve(__dirname, "..", config.facilitiesFile);

const raw: Record<string, FacilityFile> = JSON.parse(readFileSync(filePath, "utf8"));

const facilities: Record<string, Facility> = {};
for (const [id, entry] of Object.entries(raw)) {
  if (!entry.karibu_base_url) {
    throw new Error(`facilities: ${id} (${entry.name}) missing karibu_base_url`);
  }
  if (!entry.karibu_api_key_env) {
    throw new Error(`facilities: ${id} (${entry.name}) missing karibu_api_key_env`);
  }
  const apiKey = process.env[entry.karibu_api_key_env];
  if (!apiKey) {
    throw new Error(
      `facilities: ${id} (${entry.name}) references env var "${entry.karibu_api_key_env}" but it is not set`,
    );
  }
  facilities[id] = {
    name: entry.name,
    location_id: entry.location_id ?? null,
    karibuBaseUrl: entry.karibu_base_url,
    karibuApiKey: apiKey,
  };
}

log.info(
  { file: filePath, count: Object.keys(facilities).length },
  "loaded facility mapping",
);

export function getFacility(facilityId: string): Facility | undefined {
  return facilities[facilityId];
}

export function isTrackedFacility(facilityId: string): boolean {
  return facilityId in facilities;
}
