"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

const QUERY_KEY = ["avatar", "imageVersion"];

/**
 * Subscribes to the current avatar-image cache-bust version.
 * Returns 0 until bumped.
 */
export function useAvatarImageVersion(): number {
  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => 0,
    staleTime: Infinity,
  });
  return data ?? 0;
}

/**
 * Returns a function that bumps the avatar image version, causing all
 * avatar image URLs to append a fresh ?v= param and bypass browser cache.
 */
export function useBumpAvatarImageVersion(): () => void {
  const queryClient = useQueryClient();
  return () => queryClient.setQueryData<number>(QUERY_KEY, Date.now());
}
