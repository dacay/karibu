import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        // Allow assets (logos, avatars) served from the Karibu CDN
        protocol: "https",
        hostname: new URL(
          process.env.NEXT_PUBLIC_ASSETS_CDN_URL ?? "https://cdn.karibu.ai"
        ).hostname,
        pathname: "/**",
      },
    ],
  },
};

export default withSentryConfig(nextConfig, {
  // Suppresses source map uploading logs during build
  silent: true,

  // Upload source maps to Sentry for readable stack traces
  // Requires SENTRY_AUTH_TOKEN environment variable
  widenClientFileUpload: true,

  // Automatically tree-shake Sentry logger statements to reduce bundle size
  disableLogger: true,
});
