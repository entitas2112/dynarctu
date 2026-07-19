import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withHandler, methodNotAllowed } from '../_lib/handler.js';
import { getSettings } from '../_lib/config.js';
import { checkRateLimit, getSession, dropSession } from '../_lib/kv.js';
import { clientIp, getOrCreateDeviceId } from '../_lib/security.js';
import { parseQuizFinishRequest } from '../_lib/validate.js';

function httpError(status: number, message: string) {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = status;
  return err;
}

export default withHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const settings = getSettings();
  await checkRateLimit('quiz_finish', clientIp(req), settings.rateLimitDefault);
  getOrCreateDeviceId(req, res);

  const payload = parseQuizFinishRequest(req.body);
  const session = await getSession(payload.session_token);
  if (!session) throw httpError(404, 'session not found or expired');

  const total = session.questions.length;
  const correct = Object.values(session.answered).filter(Boolean).length;
  const score = total ? Math.round((correct / total) * 100) : 0;

  await dropSession(payload.session_token);

  res.status(200).json({ correctCount: correct, total, score });
});
