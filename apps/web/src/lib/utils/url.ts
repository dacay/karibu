/**
 * Extracts the subdomain from the current hostname.
 * e.g. acme.karibu.ai → "acme", demo.localhost → "demo", localhost → null
 */
export function getSubdomain(): string | null {
  if (typeof window === "undefined") return null;
  const subdomain = window.location.hostname.split(".")[0];
  return subdomain || null;
}
