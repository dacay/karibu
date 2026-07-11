// Build-time feature flags driven by NEXT_PUBLIC_* env vars.
// Opt-in convention: a feature is disabled unless the var is exactly "true".
// Rebuild the web app to change these (Next inlines NEXT_PUBLIC_* at build time).

// Admin "Avatars" section: nav entry + page. Disabled by default.
export const AVATARS_ENABLED = process.env.NEXT_PUBLIC_AVATARS_ENABLED === "true";
