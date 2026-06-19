"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/hooks/useAuth";
import { api, FONT_SIZE_SCALE, type FontSize } from "@/lib/api";

// Must match the key read by the pre-paint inline script in layout.tsx.
export const FONT_SIZE_STORAGE_KEY = "karibu:font-size";

export function applyFontSize(value: FontSize): void {
  document.documentElement.setAttribute("data-font-size", value);
  try {
    window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, value);
  } catch {
    // Ignore storage failures (private mode, quota, etc.) — the attribute still applies.
  }
}

/**
 * Reconciles the learner's saved font-size preference with the DOM. The inline
 * script in layout.tsx applies the localStorage-cached value before paint to
 * avoid a flash; this component updates both the DOM attribute and the cache
 * once the authoritative value arrives from the user profile (and reacts to the
 * optimistic cache update made when the preference is changed in AccountMenu).
 */
export function FontSizeSync() {
  const { user } = useAuth();

  const { data } = useQuery({
    queryKey: ["user", "me"],
    queryFn: api.user.me,
    enabled: !!user,
  });

  const fontSize = data?.user.fontSize;

  useEffect(() => {
    if (fontSize && fontSize in FONT_SIZE_SCALE) {
      applyFontSize(fontSize);
    }
  }, [fontSize]);

  return null;
}
