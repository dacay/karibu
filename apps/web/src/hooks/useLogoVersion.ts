"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

const QUERY_KEY = ["logo", "version"];

/**
 * Subscribes to the current logo cache-bust version.
 * Returns 0 until bumped.
 */
export function useLogoVersion(): number {
  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => 0,
    staleTime: Infinity,
  });
  return data ?? 0;
}

/**
 * Returns a function that bumps the logo version, causing all
 * `useLogo` consumers (sidebar, login, etc.) to re-fetch from CDN.
 */
export function useBumpLogoVersion(): () => void {
  const queryClient = useQueryClient();
  return () => queryClient.setQueryData<number>(QUERY_KEY, Date.now());
}
