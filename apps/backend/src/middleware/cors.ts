import { cors } from 'hono/cors'
import { env } from '../config/env.js'

export const corsMiddleware = () => {

  // Return CORS middleware configuration
  return cors({
    // Allowed origins
    origin: env.CORS_ORIGIN,
    // Allowed methods
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'User-Agent'],
    credentials: true,
  })
}
