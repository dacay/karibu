"use client";

import { useCallback, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, isTokenExpired, LOGIN_MODE_KEY, type LoginResponse } from "@/lib/api";
import { getCookie, deleteCookie } from "@/lib/utils/cookie";

const TOKEN_KEY = "karibu_token";
const USER_KEY = "karibu_user";
const PENDING_COOKIE = "karibu_pending_token";

function loadStoredAuth(): LoginResponse["user"] | null {
  if (typeof window === "undefined") return null;
  try {
    const token = localStorage.getItem(TOKEN_KEY);

    // Drop an already-expired session here rather than rendering the app and
    // waiting for the first request to 401. Access-mode sessions are short, so
    // returning to an app left open overnight is the ordinary case, and this is
    // what routes the learner straight back to /access.
    if (!token || isTokenExpired(token)) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      return null;
    }

    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as LoginResponse["user"]) : null;
  } catch {
    return null;
  }
}

export function useAuth() {
  const queryClient = useQueryClient();

  // Bootstrap from pending cookie set by middleware after token-based login
  useEffect(() => {
    const raw = getCookie(PENDING_COOKIE);
    if (!raw) return;
    try {
      const { token, user } = JSON.parse(raw) as LoginResponse;
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      deleteCookie(PENDING_COOKIE);
      queryClient.setQueryData(["auth", "user"], user);
    } catch {
      // Ignore malformed cookie
    }
  }, [queryClient]);

  const { data: user, isLoading } = useQuery({
    queryKey: ["auth", "user"],
    queryFn: loadStoredAuth,
    staleTime: Infinity,
  });

  // The stored user is a snapshot taken at login, so server-owned fields drift
  // once they change (e.g. an admin renames the organization). Reconcile them
  // against /user/me, which reads the organization row live.
  const { data: profile } = useQuery({
    queryKey: ["user", "me"],
    queryFn: api.user.me,
    enabled: !!user,
  });

  useEffect(() => {
    const organizationName = profile?.user.organizationName;
    if (!user || !organizationName || organizationName === user.organizationName) return;
    const next = { ...user, organizationName };
    localStorage.setItem(USER_KEY, JSON.stringify(next));
    queryClient.setQueryData(["auth", "user"], next);
  }, [profile, user, queryClient]);

  const storeSession = useCallback(
    (data: LoginResponse, mode: "password" | "access") => {
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));

      if (mode === "access") {
        localStorage.setItem(LOGIN_MODE_KEY, mode);
      } else {
        localStorage.removeItem(LOGIN_MODE_KEY);
      }

      queryClient.setQueryData(["auth", "user"], data.user);
    },
    [queryClient]
  );

  const loginMutation = useMutation({
    mutationFn: api.auth.login,
    onSuccess: (data) => storeSession(data, "password"),
  });

  // ID-only sign-in from the `/access` page (access-mode organizations).
  const accessLoginMutation = useMutation({
    mutationFn: api.auth.accessLogin,
    onSuccess: (data) => storeSession(data, "access"),
  });

  // LOGIN_MODE_KEY deliberately survives sign-out: it describes the device, not
  // the session, so the next visitor to a ward phone still lands on /access.
  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    queryClient.setQueryData(["auth", "user"], null);
  }, [queryClient]);

  return {
    user: user ?? null,
    isLoading,
    login: loginMutation.mutateAsync,
    accessLogin: accessLoginMutation.mutateAsync,
    logout,
  };
}
