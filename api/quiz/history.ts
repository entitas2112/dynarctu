import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withHandler, methodNotAllowed } from '../_lib/handler.js';
import { getSettings } from '../_lib/config.js';
import { checkRateLimit, clearAllHistory } from '../_lib/kv.js';
import { clientIp, getOrCreateDeviceId } from '../_lib/security.js';
import { discoverCatalog } from '../_lib/quizEngine.js';

export default withHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'DELETE') return methodNotAllowed(res, ['DELETE']);

  const settings = getSettings();
  await checkRateLimit('reset_history', clientIp(req), settings.rateLimitDefault);
  const deviceId = getOrCreateDeviceId(req, res);

  await clearAllHistory(deviceId, discoverCatalog());
  res.status(200).json({ ok: true });
});
