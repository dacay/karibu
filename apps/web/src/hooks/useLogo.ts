"use client";

import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSubdomain } from "./useSubdomain";
import { useLogoVersion } from "./useLogoVersion";

const ASSETS_CDN_BASE = process.env.NEXT_PUBLIC_ASSETS_CDN_URL ?? "https://cdn.karibu.ai";

const FALLBACK_LIGHT = "/logo-light.png";
const FALLBACK_DARK = "/logo-dark.png";

export function useLogo() {
  const { subdomain, isLoading } = useSubdomain();
  const version = useLogoVersion();
  const [lightSrc, setLightSrc] = useState(FALLBACK_LIGHT);
  const [darkSrc, setDarkSrc] = useState(FALLBACK_DARK);

  useEffect(() => {
    const suffix = version ? `?v=${version}` : "";
    const cdnLight = subdomain ? `${ASSETS_CDN_BASE}/${subdomain}/logo-light.png${suffix}` : null;
    const cdnDark = subdomain ? `${ASSETS_CDN_BASE}/${subdomain}/logo-dark.png${suffix}` : null;

    setLightSrc(cdnLight ?? FALLBACK_LIGHT);
    setDarkSrc(cdnDark ?? FALLBACK_DARK);
  }, [subdomain, version]);

  return {
    lightSrc,
    darkSrc,
    isLoading,
    onLightError: () => setLightSrc(FALLBACK_LIGHT),
    onDarkError: () => setDarkSrc(FALLBACK_DARK),
  };
}
