function boolEnv(name: string, fallback: boolean): boolean {
  const val = process.env[name];
  if (val === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(val.trim().toLowerCase());
}

function listEnv(name: string): string[] {
  const val = process.env[name] || '';
  return val
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export interface Settings {
  env: string;
  adminToken: string;
  sessionSecret: string;
  enableHsts: boolean;
  allowedOrigins: string[];
  rateLimitDefault: number;
  rateLimitQuizStart: number;
  rateLimitAdmin: number;
  quizSessionTtlSeconds: number;
}

let cached: Settings | null = null;

/**
 * Reads runtime configuration from environment variables (set in the
 * Vercel project dashboard / GitHub Actions secrets — never committed).
 *
 * ADMIN_TOKEN and SESSION_SECRET are required, mirroring the original
 * Python backend's fail-fast behaviour, so a misconfigured deployment
 * never silently runs with an empty/guessable secret.
 */
export function getSettings(): Settings {
  if (cached) return cached;

  const adminToken = process.env.ADMIN_TOKEN || '';
  const sessionSecret = process.env.SESSION_SECRET || '';

  if (!adminToken || !sessionSecret) {
    throw new Error(
      'ADMIN_TOKEN and SESSION_SECRET must be set as environment variables ' +
        '(Vercel Project Settings → Environment Variables, or GitHub Actions secrets). ' +
        'Generate strong random values, e.g. `openssl rand -base64 32`.'
    );
  }

  cached = {
    env: process.env.ENV || process.env.VERCEL_ENV || 'production',
    adminToken,
    sessionSecret,
    enableHsts: boolEnv('ENABLE_HSTS', true),
    allowedOrigins: listEnv('ALLOWED_ORIGINS'),
    rateLimitDefault: parseInt(process.env.RATE_LIMIT_DEFAULT_PER_MIN || '120', 10),
    rateLimitQuizStart: parseInt(process.env.RATE_LIMIT_QUIZ_START_PER_MIN || '12', 10),
    rateLimitAdmin: parseInt(process.env.RATE_LIMIT_ADMIN_PER_MIN || '30', 10),
    quizSessionTtlSeconds: parseInt(process.env.QUIZ_SESSION_TTL_SECONDS || String(2 * 60 * 60), 10),
  };
  return cached;
}
