"use client";

import { useState, useEffect } from "react";

const SUBDOMAIN_COOKIE = "karibu_subdomain";

/**
 * Get the subdomain from the cookie set by middleware.
 * Fallback to extracting from window.location if cookie not available.
 */
function getSubdomainFromCookie(): string | null {
  if (typeof window === "undefined") return null;

  // Try to get from cookie first (set by middleware)
  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split("=");
    if (name === SUBDOMAIN_COOKIE && value) {
      return decodeURIComponent(value);
    }
  }

  // Fallback: extract from hostname
  const subdomain = window.location.hostname.split(".")[0];
  return subdomain || null;
}

export function useSubdomain(): { subdomain: string | null; isLoading: boolean } {
  const [subdomain, setSubdomain] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setSubdomain(getSubdomainFromCookie());
    setIsLoading(false);
  }, []);

  return { subdomain, isLoading };
}
