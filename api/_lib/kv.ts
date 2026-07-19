/**
 * Persistent storage for the parts of the app that used to live in
 * server-process memory (sessions.py) or a local SQLite file (db.py).
 * Serverless functions are stateless and short-lived, so both now live
 * in Vercel KV (Upstash Redis under the hood) — attach a KV store to
 * this project in the Vercel dashboard and it auto-injects the
 * KV_REST_API_URL / KV_REST_API_TOKEN env vars this reads.
 */
import { randomBytes } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { getSettings } from './config.js';

// Vercel KV (the old @vercel/kv package) was sunset; Redis on Vercel is now
// provided via Marketplace integrations (Upstash Redis being the direct
// successor — existing Vercel KV stores were auto-migrated to it in
// December 2024). fromEnv() reads either KV_REST_API_URL/KV_REST_API_TOKEN
// or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN, whichever the
// integration injects, so this works regardless of which naming you get.
const kv = Redis.fromEnv();

export interface QuizSession {
  sessionToken: string;
  deviceId: string;
  jenjang: string;
  mapel: string;
  questions: Record<string, unknown>[]; // full records, WITH answers — never sent to the client as-is
  answered: Record<number, boolean>; // question index -> isCorrect
  createdAt: number;
  durationSeconds: number;
  finished: boolean;
}

const sessionKey = (token: string) => `dynarctu:session:${token}`;
const historyKey = (deviceId: string, jenjang: string, mapel: string) =>
  `dynarctu:history:${deviceId}:${jenjang}:${mapel}`;
const rateKey = (bucket: string, clientKey: string) => `dynarctu:rl:${bucket}:${clientKey}`;

export async function createSession(input: Omit<QuizSession, 'sessionToken' | 'createdAt' | 'answered' | 'finished'>): Promise<QuizSession> {
  const settings = getSettings();
  const session: QuizSession = {
    ...input,
    sessionToken: randomBytes(32).toString('base64url'),
    createdAt: Date.now(),
    answered: {},
    finished: false,
  };
  await kv.set(sessionKey(session.sessionToken), session, { ex: settings.quizSessionTtlSeconds });
  return session;
}

export async function getSession(token: string): Promise<QuizSession | null> {
  const session = await kv.get<QuizSession>(sessionKey(token));
  return session ?? null;
}

export async function saveSession(session: QuizSession): Promise<void> {
  const settings = getSettings();
  await kv.set(sessionKey(session.sessionToken), session, { ex: settings.quizSessionTtlSeconds });
}

export async function dropSession(token: string): Promise<void> {
  await kv.del(sessionKey(token));
}

export async function getUsedQuestionIds(deviceId: string, jenjang: string, mapel: string): Promise<Set<string>> {
  const ids = await kv.smembers(historyKey(deviceId, jenjang, mapel));
  return new Set((ids || []) as string[]);
}

export async function addUsedQuestionIds(deviceId: string, jenjang: string, mapel: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  // kv.sadd's types require at least one member (a fixed+rest tuple), which
  // TS can't infer from a plain string[] even though the length check above
  // guarantees it at runtime — assert the tuple shape explicitly.
  await kv.sadd(historyKey(deviceId, jenjang, mapel), ...(ids as [string, ...string[]]));
}

export async function clearUsedQuestions(deviceId: string, jenjang: string, mapel: string): Promise<void> {
  await kv.del(historyKey(deviceId, jenjang, mapel));
}

export async function clearAllHistory(deviceId: string, catalog: Record<string, string[]>): Promise<void> {
  const keys: string[] = [];
  for (const [jenjang, mapels] of Object.entries(catalog)) {
    for (const mapel of mapels) {
      keys.push(historyKey(deviceId, jenjang, mapel));
    }
  }
  if (keys.length) await kv.del(...(keys as [string, ...string[]]));
}

export class RateLimitError extends Error {}

/**
 * Fixed-window rate limiter backed by KV (INCR + EXPIRE), so limits hold
 * across cold starts and across the many concurrent function instances a
 * serverless deployment may run — a plain in-memory counter (fine for the
 * original single-process Python server) would not.
 */
export async function checkRateLimit(bucket: string, clientKey: string, limitPerMin: number): Promise<void> {
  const key = rateKey(bucket, clientKey);
  const count = await kv.incr(key);
  if (count === 1) {
    await kv.expire(key, 60);
  }
  if (count > limitPerMin) {
    throw new RateLimitError('too many requests, please slow down');
  }
}
