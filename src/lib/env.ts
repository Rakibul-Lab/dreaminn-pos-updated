import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  NEXT_PUBLIC_SESSION_IDLE_MINUTES: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_SECURE: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  OCR_SPACE_API_KEY: z.string().optional(),
})

export type Env = z.infer<typeof schema>

let cached: Env | null = null

/** Read validated env vars. Safe on the server only. */
export function getServerEnv(): Env {
  if (typeof window !== 'undefined') {
    throw new Error('getServerEnv() must not be called in the browser')
  }
  if (!cached) cached = schema.parse(process.env)
  return cached
}

