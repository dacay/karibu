"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import {
  initAnalytics,
  identifyUser,
  resetUser,
  trackPageview,
} from "@/lib/analytics";

/**
 * Initializes product analytics, keeps the identified user in sync with auth
 * state (login / logout / reload-with-existing-session), and tracks a pageview
 * on every client-side route change. No-op when the Mixpanel token is unset.
 */
export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const identifiedId = useRef<string | null>(null);

  useEffect(() => {
    initAnalytics();
  }, []);

  // Identify on login, re-identify after reload, reset on logout.
  useEffect(() => {
    if (user?.id) {
      if (identifiedId.current !== user.id) {
        identifyUser({
          id: user.id,
          role: user.role,
          organizationId: user.organizationId,
        });
        identifiedId.current = user.id;
      }
    } else if (identifiedId.current) {
      resetUser();
      identifiedId.current = null;
    }
  }, [user?.id, user?.role, user?.organizationId]);

  // Pageview on initial mount and every subsequent route change.
  useEffect(() => {
    trackPageview();
  }, [pathname]);

  return <>{children}</>;
}
