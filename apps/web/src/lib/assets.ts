const CDN_BASE = process.env.NEXT_PUBLIC_ASSETS_CDN_URL ?? "https://cdn.karibu.ai";
const KEY_PREFIX = process.env.NEXT_PUBLIC_ASSETS_KEY_PREFIX ?? "";

/**
 * Build a CDN URL from a key that already includes the prefix (e.g. imageS3Key from the backend).
 */
export function getAssetUrl(key: string): string {
  return `${CDN_BASE}/${key}`;
}

/**
 * Build a CDN URL for an org logo. Applies NEXT_PUBLIC_ASSETS_KEY_PREFIX since
 * logo paths are constructed on the frontend without a stored key.
 */
export function getLogoUrl(subdomain: string, variant: "light" | "dark"): string {
  const key = KEY_PREFIX
    ? `${KEY_PREFIX}/${subdomain}/logo-${variant}.png`
    : `${subdomain}/logo-${variant}.png`;

  return `${CDN_BASE}/${key}`;
}
