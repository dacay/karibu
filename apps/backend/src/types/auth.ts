import type { JWTPayload as BaseJWTPayload } from 'hono/utils/jwt/types';

export interface JWTPayload extends BaseJWTPayload {

  sub: string; // user ID
  jti: string; // session ID for revocation
  organizationId: string;
  role: 'admin' | 'user';
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
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthContext {

  userId: string;
  organizationId: string;
  sessionId: string;
  role: 'admin' | 'user';
}

// Extend Hono's context with auth context type
declare module 'hono' {

  interface ContextVariableMap {

    auth: AuthContext;
    organization: Organization;
  }
}
