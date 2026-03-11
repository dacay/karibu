"use client";

import { useState, useEffect } from "react";
import { useSubdomain } from "./useSubdomain";
import { useLogoVersion } from "./useLogoVersion";
import { getLogoUrl } from "@/lib/assets";

const FALLBACK_LIGHT = "/logo-light.png";
const FALLBACK_DARK = "/logo-dark.png";

/** Preload an image; resolves with the src on success, null on failure. */
function probeImage(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(src);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export function useLogo() {
  const { subdomain, isLoading: subdomainLoading } = useSubdomain();
  const version = useLogoVersion();
  const [lightSrc, setLightSrc] = useState<string | null>(null);
  const [darkSrc, setDarkSrc] = useState<string | null>(null);
  const [probing, setProbing] = useState(true);

  useEffect(() => {
    if (subdomainLoading) return;

    if (!subdomain) {
      setLightSrc(FALLBACK_LIGHT);
      setDarkSrc(FALLBACK_DARK);
      setProbing(false);
      return;
    }

    setProbing(true);
    let cancelled = false;
    const suffix = version ? `?v=${version}` : "";
    const cdnLight = `${getLogoUrl(subdomain, "light")}${suffix}`;
    const cdnDark = `${getLogoUrl(subdomain, "dark")}${suffix}`;

    Promise.all([probeImage(cdnLight), probeImage(cdnDark)]).then(
      ([light, dark]) => {
        if (cancelled) return;
        setLightSrc(light ?? FALLBACK_LIGHT);
        setDarkSrc(dark ?? FALLBACK_DARK);
        setProbing(false);
      }
    );

    return () => { cancelled = true; };
  }, [subdomain, subdomainLoading, version]);

  return { lightSrc, darkSrc, isLoading: subdomainLoading || probing };
}
