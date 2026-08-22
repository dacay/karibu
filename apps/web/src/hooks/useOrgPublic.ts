"use client";

import { useQuery } from "@tanstack/react-query";
import { api, type PublicOrg } from "@/lib/api";

/**
 * Org metadata available without authentication (logo timestamp, access mode).
 * Shares the "org-public" query key with useLogo so both hooks hit the endpoint once.
 */
export function useOrgPublic(): { org: PublicOrg | undefined; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ["org-public"],
    queryFn: () => api.org.getPublic(),
  });

  return { org: data, isLoading };
}

/** Label the organization uses for its ID on the access page (e.g. "UCSF ID"). */
export function accessIdLabel(org: PublicOrg | undefined): string {
  return org?.accessIdLabel?.trim() || "ID";
}
