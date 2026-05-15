import type { JWTPayload as BaseJWTPayload } from 'hono/utils/jwt/types';

export interface JWTPayload extends BaseJWTPayload {

  sub: string; // user ID for human tokens, service-account ID for service tokens
  jti: string; // credential ID for revocation (auth_sessions.id or api_keys.id)
  organizationId: string;
  role: 'admin' | 'user';
  kind?: 'user' | 'service'; // absent = 'user' (back-compat with already-issued human tokens)
}

export interface User {

  id: string;
  email: string;
  phoneNumber: string | null;
  role: 'admin' | 'user';
  organizationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Session {

  id: string;
  userId: string;
  jti: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface LoginToken {

  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface Organization {

  id: string;
  name: string;
  subdomain: string;
  pronunciation: string | null;
  defaultAvatarId: string | null;
  logoUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type AuthContext =
  | {
      kind: 'user';
      userId: string;
      organizationId: string;
      sessionId: string;
      role: 'admin' | 'user';
    }
  | {
      kind: 'service';
      serviceAccountId: string;
      apiKeyId: string;
      organizationId: string;
      role: 'admin';
    };

/**
 * Narrowed AuthContext for user-only routes (default `authMiddleware()`).
 * Cast `c.get('auth') as UserAuthContext` in handlers — safe because the
 * middleware 403s service tokens before the handler runs.
 */
export type UserAuthContext = Extract<AuthContext, { kind: 'user' }>;

// Extend Hono's context with auth context type
declare module 'hono' {

  interface ContextVariableMap {

    auth: AuthContext;
    organization: Organization;
  }
}
