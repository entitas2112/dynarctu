import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withHandler, methodNotAllowed } from '../../_lib/handler.js';
import { getSettings } from '../../_lib/config.js';
import { checkRateLimit } from '../../_lib/kv.js';
import { clientIp, requireAdminToken } from '../../_lib/security.js';
import { clearCache } from '../../_lib/quizEngine.js';

export default withHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  requireAdminToken(req);
  const settings = getSettings();
  await checkRateLimit('admin', clientIp(req), settings.rateLimitAdmin);

  // Clears the in-memory parsed-question-bank cache for this warm lambda
  // instance. Note each cold start / new instance already re-reads from
  // disk, so this mainly matters if you re-deploy data without a full
  // redeploy (rare on Vercel, kept for interface parity with the original).
  clearCache();
  res.status(200).json({ ok: true });
});
