import mixpanel from "mixpanel-browser";

/**
 * Provider-agnostic product analytics wrapper (web).
 *
 * Thin façade over the vendor SDK so the provider can be swapped in one place.
 * No-op when NEXT_PUBLIC_MIXPANEL_TOKEN is unset.
 *
 * Event names live in EVENTS (Title Case "Object Action"); property keys are
 * snake_case. Identity (role, organization_id) is registered as Mixpanel super
 * properties at identify time, so it rides on every event automatically.
 */

export const EVENTS = {
  microlearningViewed: "Microlearning Viewed",
} as const;

type EventName = (typeof EVENTS)[keyof typeof EVENTS];

const TOKEN = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN;
const API_HOST = process.env.NEXT_PUBLIC_MIXPANEL_API_HOST;

let enabled = false;

export function initAnalytics(): void {
  if (!TOKEN || enabled || typeof window === "undefined") return;

  mixpanel.init(TOKEN, {
    // Pageviews are tracked manually on route change (see AnalyticsProvider) so
    // SPA navigations are captured; disable the built-in initial-load tracker to
    // avoid double counting.
    track_pageview: false,
    persistence: "localStorage",
    ...(API_HOST ? { api_host: `https://${API_HOST}` } : {}),
  });

  enabled = true;
}

export function track(event: EventName, props?: Record<string, unknown>): void {
  if (!enabled) return;
  mixpanel.track(event, props);
}

/** Start a duration timer; the next track() of `event` carries $duration. */
export function startTimer(event: EventName): void {
  if (!enabled) return;
  mixpanel.time_event(event);
}

export function trackPageview(): void {
  if (!enabled) return;
  mixpanel.track_pageview();
}

export function identifyUser({
  id,
  role,
  organizationId,
}: {
  id: string;
  role: "admin" | "user";
  organizationId: string;
}): void {
  if (!enabled) return;
  mixpanel.identify(id);
  mixpanel.register({ role, organization_id: organizationId });
  mixpanel.people.set({ role, organization_id: organizationId });
}

export function resetUser(): void {
  if (!enabled) return;
  mixpanel.reset();
}
