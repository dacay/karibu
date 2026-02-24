import { z } from 'zod'
import 'dotenv/config'

const envSchema = z.object({

  // Server
  PORT: z.string().default('3000').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Database
  DATABASE_URL: z.string().url(),

  // CORS (comma-separated list of origins)
  CORS_ORIGIN: z.string()
    .transform((val) => val.split(',').map((origin) => origin.trim()))
    .pipe(z.array(z.string().url())),

  // JWT Configuration
  JWT_SECRET: z.string().min(32),
  JWT_AUDIENCE: z.string().url().default('https://test.karibu.ai'),
  JWT_EXPIRATION: z.string().default('30d'),
  JWT_ALGORITHM: z.enum(['HS256', 'HS384', 'HS512']).default('HS256'),

  // Notification Channels (comma-separated, e.g. "sms")
  NOTIFICATION_CHANNELS: z.string()
    .default('')
    .transform((val) => val.split(',')
      .map((ch) => ch.trim().toLowerCase())
      .filter((ch) => ch.length > 0)),

  // Twilio Configuration (SMS Notifications)
  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TWILIO_PHONE_NUMBER: z.string().regex(/^\+[1-9]\d{1,14}$/).optional(), // E.164 format

  // Error Reporting (Sentry)
  SENTRY_DSN: z.string().url().optional(),

  // AI / LLM
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  ELEVENLABS_API_KEY: z.string().min(1).optional(),

  // AWS S3 (Document Storage)
  AWS_REGION: z.string().min(1).optional(),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_BUCKET_NAME: z.string().min(1).optional(),
  S3_MAX_UPLOAD_SIZE_MB: z.string().default('20').transform(Number),
  S3_KEY_PREFIX: z.string().default('').transform((val) => val.replace(/^\/+|\/+$/g, '')),

  // DNA Synthesis
  DNA_SYNTHESIS_MIN_VALUES: z.string().default('5').transform(Number),
  DNA_SYNTHESIS_MAX_VALUES: z.string().default('10').transform(Number),
  DNA_SYNTHESIS_MAX_WORDS_PER_VALUE: z.string().default('50').transform(Number),

  // ChromaDB Cloud (Vector Database)
  CHROMA_API_KEY: z.string().min(1),
  CHROMA_TENANT: z.string().min(1),
  CHROMA_DATABASE: z.string().min(1),
  CHROMA_COLLECTION_NAME: z.string().min(1).default('karibu-documents'),

  // Postmark (transactional email)
  POSTMARK_API_KEY: z.string().min(1).optional(),
  POSTMARK_FROM: z.string().default('noreply@karibu.ai'),

  // URL template for building org-scoped frontend links.
  // Use {subdomain} as the placeholder: e.g. "https://{subdomain}.karibu.ai"
  // For local dev omit the placeholder: e.g. "http://localhost:3001"
  FRONTEND_URL_TEMPLATE: z.string().min(1).default('http://localhost:3001'),
})

const parseEnv = () => {

  try {

    return envSchema.parse(process.env)

  } catch (error) {

    if (error instanceof z.ZodError) {

      console.error('Invalid environment variables:')

      error.issues.forEach((issue) => {
        console.error(`  - ${issue.path.join('.')}: ${issue.message}`)
      })

      process.exit(1)
    }

    throw error
  }
}

export const env = parseEnv()
