import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { parse as parseCookie, serialize as serializeCookie } from 'cookie';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSettings } from './config.js';

export const DEVICE_COOKIE_NAME = 'dynarctu_device';

function sign(value: string, secret: string): string {
  const mac = createHmac('sha256', secret).update(value).digest('hex');
  return `${value}.${mac}`;
}

function verify(signed: string, secret: string): string | null {
  const idx = signed.lastIndexOf('.');
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  const mac = signed.slice(idx + 1);
  const expected = createHmac('sha256', secret).update(value).digest('hex');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return value;
}

/**
 * Reads (or mints) a signed, anonymous per-browser device id, used only to
 * key non-sensitive quiz-history rows (which questions a browser has
 * already seen) — never for privileged access. Signed with HMAC so a
 * client can't pick an arbitrary device id and tamper with someone else's
 * rotation history.
 */
export function getOrCreateDeviceId(req: VercelRequest, res: VercelResponse): string {
  const settings = getSettings();
  const cookies = req.cookies || parseCookie(req.headers.cookie || '');
  const raw = cookies[DEVICE_COOKIE_NAME];
  let deviceId = raw ? verify(raw, settings.sessionSecret) : null;

  if (!deviceId) {
    deviceId = randomBytes(24).toString('base64url');
    const signed = sign(deviceId, settings.sessionSecret);
    const cookieStr = serializeCookie(DEVICE_COOKIE_NAME, signed, {
      maxAge: 365 * 24 * 60 * 60,
      httpOnly: true,
      secure: settings.env !== 'development',
      sameSite: 'lax',
      path: '/',
    });
    appendSetCookie(res, cookieStr);
  }
  return deviceId;
}

function appendSetCookie(res: VercelResponse, cookieStr: string): void {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', cookieStr);
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookieStr]);
  } else {
    res.setHeader('Set-Cookie', [existing as string, cookieStr]);
  }
}

/** Constant-time bearer-token check for /api/admin/* routes. */
export function requireAdminToken(req: VercelRequest): void {
  const settings = getSettings();
  const auth = (req.headers.authorization as string) || '';
  const prefix = 'Bearer ';
  const token = auth.startsWith(prefix) ? auth.slice(prefix.length) : '';
  const a = Buffer.from(token);
  const b = Buffer.from(settings.adminToken);
  if (!token || a.length !== b.length || !timingSafeEqual(a, b)) {
    const err = new Error('unauthorized') as Error & { statusCode: number };
    err.statusCode = 401;
    throw err;
  }
}

export function clientIp(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return value.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

/** Same header set as the original SecureHeadersMiddleware. */
export function applySecurityHeaders(req: VercelRequest, res: VercelResponse): void {
  const settings = getSettings();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
      "script-src 'self' https://cdn.jsdelivr.net; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      'font-src https://fonts.gstatic.com https://cdn.jsdelivr.net; ' +
      "img-src 'self' data:; " +
      "connect-src 'self'; " +
      "object-src 'none'; " +
      "base-uri 'none'; " +
      "frame-ancestors 'none'"
  );
  if (settings.enableHsts) {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }
  if (settings.allowedOrigins.length) {
    const origin = (req.headers.origin as string) || '';
    if (settings.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
  }
  // Same-origin default (no ALLOWED_ORIGINS set): no CORS headers are added
  // at all, so the browser's same-origin policy blocks all cross-origin
  // access to the API — correct default for an app that ships its own
  // frontend from the same Vercel deployment/domain.
}
