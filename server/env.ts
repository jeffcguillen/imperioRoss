import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(Number(process.env.PORT) || 3000),
  WEB_ORIGINS: z.string().default('http://localhost:5173'),
  DEFAULT_TENANT_SLUG: z.string().min(1).default('imperio-de-ross'),
  DATABASE_STAFF_URL: z.string().url(),
  DATABASE_ADMIN_URL: z.string().url(),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  STORAGE_PATH: z.string().default('./var/private-uploads'),
  MAX_PROOF_FILE_BYTES: z.coerce.number().int().min(1024).max(5_242_880).default(5_242_880),
  SCHEDULED_PLAYS_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  SCHEDULED_PLAYS_TENANT_IDS: z.string().default('').transform((value) => value.split(',').map((id) => id.trim()).filter(Boolean)),
  SCHEDULED_PLAYS_INTERVAL_MS: z.coerce.number().int().min(5_000).max(300_000).default(30_000),
  SCHEDULED_PLAYS_LOOKAHEAD_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
  SCHEDULED_PLAYS_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(25),
}).superRefine((config, context) => {
  if (config.SCHEDULED_PLAYS_ENABLED && config.SCHEDULED_PLAYS_TENANT_IDS.length === 0) {
    context.addIssue({ code: 'custom', path: ['SCHEDULED_PLAYS_TENANT_IDS'], message: 'El scheduler requiere una lista explícita de tenants autorizados.' });
  }
  if (config.SCHEDULED_PLAYS_TENANT_IDS.some((id) => !z.string().uuid().safeParse(id).success)) {
    context.addIssue({ code: 'custom', path: ['SCHEDULED_PLAYS_TENANT_IDS'], message: 'La lista de tenants del scheduler debe contener UUID válidos.' });
  }
});

export const env = envSchema.parse(process.env);
export const webOrigins = env.WEB_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
