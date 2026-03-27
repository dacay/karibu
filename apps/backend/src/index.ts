import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { pinoLogger } from 'hono-pino'
import { WebSocketServer } from 'ws'
import { env } from './config/env.js'
import { logger } from './config/logger.js'
import { corsMiddleware } from './middleware/cors.js'
import { errorReporterMiddleware } from './middleware/errorReporter.js'
import { registerRoutes } from './routes/index.js'
import { sql, testConnection } from './db/index.js'
import { initErrorReporter } from './utils/errorReporter.js'
import { verifyToken } from './utils/jwt.js'
import { handleTTSStream } from './routes/tts-stream.js'

initErrorReporter()

const app = new Hono()

// Apply logging middleware
// At debug level: logs method, url, status. At trace level: logs full headers too.
app.use('*', pinoLogger({
  pino: logger,
  http: {
    onReqBindings: (c) => ({ req: { method: c.req.method, url: c.req.path } }),
    onResBindings: (c) => ({ res: { status: c.res.status } }),
    onResLevel: (c) => c.error ? 'error' : 'trace',
  },
}))

// Apply CORS middleware
app.use('*', corsMiddleware())

// Register routes
registerRoutes(app)

// Catch and report unexpected errors
app.onError(errorReporterMiddleware)

// Test database connection before starting server
const dbConnected = await testConnection()

if (!dbConnected) {

  logger.fatal('Due to database connection failure, the server will not start. Exiting.')
  process.exit(1)
}

// Start server
const server = serve({
  fetch: app.fetch,
  port: env.PORT
}, (info) => {

  logger.info(`Server is running on http://localhost:${info.port}...`)
})

// ─── WebSocket upgrade handler for streaming TTS ────────────────────────────
const wss = new WebSocketServer({ noServer: true })

const DEFAULT_VOICE_ID = process.env.DEFAULT_VOICE_ID ?? 'aura-2-asteria-en'

server.on('upgrade', async (request, socket, head) => {
  const url = new URL(request.url!, `http://${request.headers.host}`)

  if (url.pathname !== '/chat/tts-stream') {
    socket.destroy()
    return
  }

  // Authenticate via query-string token (browsers can't send WS headers)
  const token = url.searchParams.get('token')
  if (!token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return
  }

  try {
    await verifyToken(token)
  } catch {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return
  }

  const voiceId = url.searchParams.get('voiceId') ?? DEFAULT_VOICE_ID

  wss.handleUpgrade(request, socket, head, (ws) => {
    handleTTSStream(ws, voiceId)
  })
})

// Graceful shutdown
const gracefulShutdown = async () => {
  logger.info('Shutting down gracefully...')
  await sql.end()
  process.exit(0)
}

process.on('SIGINT', gracefulShutdown)
process.on('SIGTERM', gracefulShutdown)
