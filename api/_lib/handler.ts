import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applySecurityHeaders } from './security.js';
import { RateLimitError } from './kv.js';
import { ValidationError } from './validate.js';
import { QuestionBankError } from './quizEngine.js';

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void> | void;

interface StatusError extends Error {
  statusCode?: number;
}

/**
 * Wraps a route handler so every response gets the same security headers,
 * and every thrown error is sanitized before it reaches the client — never
 * leaking stack traces or internal details, matching the original
 * FastAPI `unhandled_exception_handler` / `validation_exception_handler`.
 * Full detail still goes to the function's server-side logs.
 */
export function withHandler(fn: Handler) {
  return async (req: VercelRequest, res: VercelResponse) => {
    applySecurityHeaders(req, res);
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof RateLimitError) {
        res.status(429).json({ error: 'too many requests, please slow down' });
        return;
      }
      if (err instanceof ValidationError) {
        res.status(422).json({ error: 'invalid request' });
        return;
      }
      if (err instanceof QuestionBankError) {
        res.status(404).json({ error: 'question bank not available' });
        return;
      }
      const statusErr = err as StatusError;
      if (statusErr.statusCode) {
        res.status(statusErr.statusCode).json({ error: statusErr.message || 'error' });
        return;
      }
      // eslint-disable-next-line no-console
      console.error(`Unhandled error on ${req.method} ${req.url}:`, err);
      res.status(500).json({ error: 'internal server error' });
    }
  };
}

export function methodNotAllowed(res: VercelResponse, allowed: string[]): void {
  res.setHeader('Allow', allowed.join(', '));
  res.status(405).json({ error: 'method not allowed' });
}
