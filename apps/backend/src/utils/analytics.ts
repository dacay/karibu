import Mixpanel from 'mixpanel'
import type { Context } from 'hono'

import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import type { AuthContext } from '../types/auth.js'

/**
 * Provider-agnostic product analytics wrapper.
 *
 * Mirrors utils/errorReporter.ts: a thin façade over the vendor SDK so the
 * provider can be swapped in one place. No-op when MIXPANEL_TOKEN is unset.
 *
 * Event names live in EVENTS (single source of truth — Title Case "Object
 * Action"). Property keys are snake_case. Every event carries the global
 * identity props (distinct_id / role / organization_id), injected here so call
 * sites never have to remember them.
 */

export const EVENTS = {
  userLoggedIn: 'User Logged In',
  messageSent: 'Message Sent',
  microlearningCompleted: 'Microlearning Completed',
} as const

type EventName = (typeof EVENTS)[keyof typeof EVENTS]

let client: ReturnType<typeof Mixpanel.init> | null = null

export function initAnalytics(): void {

  if (env.MIXPANEL_TOKEN) {

    client = Mixpanel.init(env.MIXPANEL_TOKEN, { host: env.MIXPANEL_API_HOST })

    logger.info('Mixpanel product analytics initialized.')

  } else {

    logger.warn('MIXPANEL_TOKEN not set — product analytics disabled.')

  }
}

interface CaptureArgs {
  distinctId: string
  event: EventName
  role: 'admin' | 'user'
  organizationId: string
  props?: Record<string, unknown>
}

/**
 * Low-level capture for events that fire before an auth context exists (login).
 */
export function capture({ distinctId, event, role, organizationId, props }: CaptureArgs): void {

  if (!client) return

  client.track(event, {
    distinct_id: distinctId,
    role,
    organization_id: organizationId,
    ...props,
  })
}

/**
 * Track an event for the authenticated principal. Reads the verified auth
 * context off the request, so role + distinct id are guaranteed and
 * non-spoofable. No-op for service tokens — integration traffic isn't a person.
 */
export function trackEvent(c: Context, event: EventName, props?: Record<string, unknown>): void {

  if (!client) return

  const auth = c.get('auth') as AuthContext | undefined

  if (!auth || auth.kind !== 'user') return

  client.track(event, {
    distinct_id: auth.userId,
    role: auth.role,
    organization_id: auth.organizationId,
    ...props,
  })
}
