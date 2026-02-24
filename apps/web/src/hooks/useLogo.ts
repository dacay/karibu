"use client";

import { useState, useEffect } from "react";
import { useSubdomain } from "./useSubdomain";

const CDN_BASE = process.env.NEXT_PUBLIC_CDN_URL ?? "https://cdn.karibu.ai";

const FALLBACK_LIGHT = "/logo-light.png";
const FALLBACK_DARK = "/logo-dark.png";

export function useLogo() {
  const { subdomain, isLoading } = useSubdomain();
  const [lightSrc, setLightSrc] = useState(FALLBACK_LIGHT);
  const [darkSrc, setDarkSrc] = useState(FALLBACK_DARK);

  useEffect(() => {
    const cdnLight = subdomain ? `${CDN_BASE}/${subdomain}/logo-light.png` : null;
    const cdnDark = subdomain ? `${CDN_BASE}/${subdomain}/logo-dark.png` : null;

    setLightSrc(cdnLight ?? FALLBACK_LIGHT);
    setDarkSrc(cdnDark ?? FALLBACK_DARK);
  }, [subdomain]);

  return {
    lightSrc,
    darkSrc,
    isLoading,
    onLightError: () => setLightSrc(FALLBACK_LIGHT),
    onDarkError: () => setDarkSrc(FALLBACK_DARK),
  };
}
