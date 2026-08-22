"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * Admin-side view of the organization's access mode: whether the ID-only
 * `/access` page is on, and what the org calls that ID. Drives the optional
 * ID fields on the Team page. Shares the ["org", "config"] query key with the
 * other admin sections, so it costs no extra request.
 */
export function useAccessMode(): { enabled: boolean; label: string } {
  const { data } = useQuery({
    queryKey: ["org", "config"],
    queryFn: api.org.getConfig,
  });

  return {
    enabled: data?.accessModeEnabled ?? false,
    label: data?.accessIdLabel?.trim() || "ID",
  };
}
